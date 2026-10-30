/**
 * Detector de vivacidade ativa (2 piscadas) — v2
 *
 * Arquitetura em 3 camadas independentes:
 *
 *  1. FonteMediaPipe   → landmarks + blendshapes reais (eyeBlinkLeft/Right) do Face Landmarker,
 *                        com portões de qualidade (rosto presente, centralizado, frontal, parado).
 *  2. MaquinaPiscadas  → máquina de estados PURA (sem DOM, sem câmera). Recebe amostras
 *                        { t, rostoOk, fechamento } e é 100% testável com timestamps sintéticos.
 *  3. DetectorPiscadas → cola: câmera → fonte → máquina → callbacks + captura da foto.
 *
 * Self-host obrigatório (PWA/iOS): arquivos estáticos em /public
 *   /public/mediapipe/wasm/*
 *   /public/mediapipe/face_landmarker.task (float16, ~3.6 MB)
 */

import type { FaceLandmarker } from "@mediapipe/tasks-vision";

/* ============================================================================
 * Tipos públicos
 * ========================================================================== */

export type EstadoMaquina =
  "AGUARDANDO_ROSTO" | "ESTABILIZANDO" | "PISQUE_1" | "PISQUE_2" | "CAPTURANDO" | "SUCESSO";

export type EstadoLiveness =
  EstadoMaquina | "CARREGANDO" | "ERRO" | "CALIBRANDO" | "WAITING_FOR_FACE";
export type MotivoReset = "rosto" | "intervalo";
export type MotivoRosto =
  "OK" | "SEM_ROSTO" | "LONGE" | "PERTO" | "FORA_DO_CENTRO" | "DE_PERFIL" | "MOVIMENTO";

export interface EvidenciaLiveness {
  sessaoId: string;
  desafioConcluido: boolean;
  duracaoTotalMs: number;
  earMedioAberto: number;
  earMinimoFechado: number;
  duracaoPiscada1Ms: number;
  duracaoPiscada2Ms: number;
  timestampConclusao: string;
  fonteSinal?: "blendshapes" | "ear";
}

export interface MetricasLiveness {
  estado: EstadoLiveness;
  /** EAR real (Soukupová & Čech) calculado sobre os landmarks, média dos dois olhos. */
  bilateralEar: number;
  earAbertoBaseline: number;
  /** Sinal usado pela máquina: 0 = olhos abertos, 1 = fechados. */
  fechamento?: number;
  contagemPiscadas: number;
  duracaoPiscada1Ms?: number;
  duracaoPiscada2Ms?: number;
  faceEstavel: boolean;
  /** Use para dicas na UI ("Aproxime o rosto", "Olhe de frente"...). */
  motivoRosto?: MotivoRosto;
  sessaoId: string;
}

export interface ConfigMaquina {
  /** Amostras consecutivas mínimas com olho fechado (2 ≈ 66 ms a 30 fps). */
  minAmostrasFechado: number;
  minFechadoMs: number;
  /** Acima disso é "olho fechado", não piscada. */
  maxFechadoMs: number;
  /** Fechamento que ocorre menos de X ms após a reabertura é jitter, não piscada nova. */
  intervaloMinMs: number;
  /** Tempo máximo entre a 1ª e a 2ª piscada. */
  intervaloMaxMs: number;
  /** Rosto OK + olhos abertos por este tempo antes de aceitar a 1ª piscada. */
  estabilidadeMs: number;
  /** Perdas de rosto menores que isso são ignoradas (não contam como olho fechado nem resetam). */
  toleranciaPerdaRostoMs: number;
  /** Após a 2ª piscada, espera olhos abertos e estáveis por X ms para fotografar. */
  capturaEstavelMs: number;
  capturaMaxEsperaMs: number;
}

export interface ConfigDetectorPiscada {
  caminhoWasm?: string;
  caminhoModelo?: string;
  /** Ordem de tentativa. Se o GPU travar no iOS, use ["CPU"]. */
  delegates?: Array<"GPU" | "CPU">;
  timeoutCarregamentoMs?: number;
  maquina?: Partial<ConfigMaquina>;
  onPiscada?: (numero: number) => void;
  /** Disparado quando o desafio foi concluído e o rosto está pronto para a foto. */
  onDuploPisqueConfirmado?: () => void;
  onMelhorFrameCapturado?: (fotoBase64: string, evidencia: EvidenciaLiveness) => void;
  onReset?: (motivo: MotivoReset) => void;
  onEstadoOlhos?: (estado: "calibrando" | "aberto" | "fechado") => void;
  onEstado?: (estado: EstadoLiveness) => void;
  onMetricas?: (metricas: MetricasLiveness) => void;
  onErro?: (erro: Error) => void;
}

export interface Ponto2D {
  x: number;
  y: number;
}

/* ============================================================================
 * Geometria
 * ========================================================================== */

export function distanciaEuclidiana(p1: Ponto2D, p2: Ponto2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * EAR de Soukupová & Čech (2016): (‖p2−p6‖ + ‖p3−p5‖) / (2·‖p1−p4‖)
 * IMPORTANTE: passe pontos em PIXELS (não normalizados 0–1), senão a razão de aspecto distorce o EAR.
 */
export function calcularEar(
  p1: Ponto2D,
  p2: Ponto2D,
  p3: Ponto2D,
  p4: Ponto2D,
  p5: Ponto2D,
  p6: Ponto2D,
): number {
  const dH = distanciaEuclidiana(p1, p4);
  if (dH <= 1e-4) return 0.25;
  return (distanciaEuclidiana(p2, p6) + distanciaEuclidiana(p3, p5)) / (2 * dH);
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/* ============================================================================
 * Camada 2 — Máquina de estados pura
 * ========================================================================== */

export interface AmostraOlhos {
  /** ms, monotônico */
  t: number;
  /** Rosto presente E apto (centralizado, frontal, parado). Se false, a amostra é IGNORADA. */
  rostoOk: boolean;
  /** Média dos dois olhos: 0 aberto … 1 fechado */
  fechamento: number;
  /** Menor dos dois olhos (rejeita piscadas de um olho só / ruído unilateral) */
  fechamentoMin: number;
}

export interface SnapshotMaquina {
  estado: EstadoMaquina;
  contagem: number;
  olhoFechado: boolean;
  base: number;
  duracoes: [number, number];
}

export interface EventosMaquina {
  onPiscada?: (numero: number, duracaoMs: number) => void;
  onReset?: (motivo: MotivoReset) => void;
  onEstado?: (estado: EstadoMaquina) => void;
  onCapturaPronta?: () => void;
}

export const CONFIG_MAQUINA_PADRAO: ConfigMaquina = {
  minAmostrasFechado: 2,
  minFechadoMs: 30,
  maxFechadoMs: 700,
  intervaloMinMs: 100,
  intervaloMaxMs: 4000,
  estabilidadeMs: 600,
  toleranciaPerdaRostoMs: 400,
  capturaEstavelMs: 150,
  capturaMaxEsperaMs: 1000,
};

export class MaquinaPiscadas {
  private cfg: ConfigMaquina;
  private ev: Required<EventosMaquina>;

  private estado: EstadoMaquina = "AGUARDANDO_ROSTO";
  private contagem = 0;
  private duracoes: [number, number] = [0, 0];

  // Fase do olho é ORTOGONAL à contagem (evita a explosão de estados REABRINDO_x da v1)
  private olhoFechado = false;
  private fechouEm = 0;
  private reabriuEm = 0;
  private amostrasFechado = 0;
  private ruido = false;

  private base = 0.1; // fechamento "em repouso" do usuário (adaptativo)
  private ultimoRostoOk = 0;
  private estavelDesde = 0;
  private capturaDesde = 0;
  private abertoDesde: number | null = null;

  constructor(cfg: Partial<ConfigMaquina> = {}, eventos: EventosMaquina = {}) {
    this.cfg = { ...CONFIG_MAQUINA_PADRAO, ...cfg };
    this.ev = {
      onPiscada: eventos.onPiscada ?? (() => {}),
      onReset: eventos.onReset ?? (() => {}),
      onEstado: eventos.onEstado ?? (() => {}),
      onCapturaPronta: eventos.onCapturaPronta ?? (() => {}),
    };
  }

  public resetar(): void {
    this.contagem = 0;
    this.duracoes = [0, 0];
    this.olhoFechado = false;
    this.amostrasFechado = 0;
    this.ruido = false;
    this.abertoDesde = null;
    this.base = 0.1;
    this.mudar("AGUARDANDO_ROSTO");
  }

  public snapshot(): SnapshotMaquina {
    return {
      estado: this.estado,
      contagem: this.contagem,
      olhoFechado: this.olhoFechado,
      base: this.base,
      duracoes: [...this.duracoes],
    };
  }

  /** Histerese SEM sobreposição: sempre abrir < fechar (a v1 tinha faixas que se cruzavam). */
  private limiares(): { fechar: number; abrir: number } {
    const fechar = clamp(this.base + 0.35, 0.5, 0.8);
    const abrir = clamp(this.base + 0.15, 0.25, fechar - 0.15);
    return { fechar, abrir };
  }

  public processar(a: AmostraOlhos): SnapshotMaquina {
    if (this.estado === "SUCESSO") return this.snapshot();

    if (!a.rostoOk) {
      this.aoPerderRosto(a.t);
      return this.snapshot();
    }
    this.ultimoRostoOk = a.t;

    if (this.estado === "AGUARDANDO_ROSTO") {
      this.mudar("ESTABILIZANDO");
      this.estavelDesde = a.t;
      this.base = clamp(a.fechamento, 0, 0.4);
    }

    if (this.estado === "ESTABILIZANDO") this.estabilizar(a);
    else if (this.estado === "CAPTURANDO") this.aguardarCaptura(a);
    else this.processarPiscadas(a);

    return this.snapshot();
  }

  private mudar(e: EstadoMaquina): void {
    if (e === this.estado) return;
    this.estado = e;
    this.ev.onEstado(e);
  }

  private aoPerderRosto(t: number): void {
    if (this.estado === "AGUARDANDO_ROSTO") return;
    if (this.estado === "CAPTURANDO") {
      if (t - this.capturaDesde >= this.cfg.capturaMaxEsperaMs) this.concluir();
      return;
    }
    if (t - this.ultimoRostoOk > this.cfg.toleranciaPerdaRostoMs) {
      this.resetar();
      this.ev.onReset("rosto");
    }
  }

  private estabilizar(a: AmostraOlhos): void {
    if (a.fechamento > 0.3) {
      this.estavelDesde = a.t; // olho fechado/semicerrado: recomeça a contagem de estabilidade
    } else {
      this.base = this.base * 0.8 + a.fechamento * 0.2;
    }
    if (a.t - this.estavelDesde >= this.cfg.estabilidadeMs) {
      this.olhoFechado = false;
      this.mudar("PISQUE_1");
    }
  }

  private processarPiscadas(a: AmostraOlhos): void {
    const t = a.t;
    const { fechar, abrir } = this.limiares();

    if (!this.olhoFechado) {
      if (this.contagem === 1 && t - this.reabriuEm > this.cfg.intervaloMaxMs) {
        this.contagem = 0;
        this.mudar("PISQUE_1");
        this.ev.onReset("intervalo");
        return;
      }
      if (a.fechamento >= fechar && a.fechamentoMin >= fechar * 0.6) {
        this.olhoFechado = true;
        this.fechouEm = t;
        this.amostrasFechado = 1;
        this.ruido = this.contagem === 1 && t - this.reabriuEm < this.cfg.intervaloMinMs;
      } else if (a.fechamento < 0.4) {
        this.base = this.base * 0.98 + a.fechamento * 0.02;
      }
      return;
    }

    // Olho fechado: só reabre ao cruzar o limiar de ABERTURA (histerese)
    if (a.fechamento <= abrir) {
      const dur = t - this.fechouEm;
      this.olhoFechado = false;
      this.reabriuEm = t;
      const valida =
        !this.ruido &&
        this.amostrasFechado >= this.cfg.minAmostrasFechado &&
        dur >= this.cfg.minFechadoMs &&
        dur <= this.cfg.maxFechadoMs;
      if (valida) this.registrar(t, dur);
    } else if (a.fechamento >= fechar) {
      this.amostrasFechado++;
    }
  }

  private registrar(t: number, dur: number): void {
    this.contagem++;
    if (this.contagem === 1) {
      this.duracoes[0] = Math.round(dur);
      this.mudar("PISQUE_2");
      this.ev.onPiscada(1, dur);
    } else {
      this.duracoes[1] = Math.round(dur);
      this.capturaDesde = t;
      this.abertoDesde = null;
      this.mudar("CAPTURANDO");
      this.ev.onPiscada(2, dur);
    }
  }

  /** Só fotografa com olhos de fato abertos — a v1 capturava no instante da reabertura (meio fechado). */
  private aguardarCaptura(a: AmostraOlhos): void {
    const { abrir } = this.limiares();
    if (a.fechamento <= abrir) this.abertoDesde ??= a.t;
    else this.abertoDesde = null;

    const estavel =
      this.abertoDesde !== null && a.t - this.abertoDesde >= this.cfg.capturaEstavelMs;
    const esgotou = a.t - this.capturaDesde >= this.cfg.capturaMaxEsperaMs;
    if (estavel || esgotou) this.concluir();
  }

  private concluir(): void {
    this.mudar("SUCESSO");
    this.ev.onCapturaPronta();
  }
}

/* ============================================================================
 * Camada 1 — Fonte de sinal (MediaPipe Face Landmarker)
 * ========================================================================== */

interface LeituraRosto {
  rostoOk: boolean;
  motivo: MotivoRosto;
  fechamento: number;
  fechamentoMin: number;
  ear: number;
  fonte: "blendshapes" | "ear";
}

interface OpcoesFonte {
  caminhoWasm: string;
  caminhoModelo: string;
  delegates: Array<"GPU" | "CPU">;
  timeoutMs: number;
}

function comTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

// Índices MediaPipe (468 pts) para EAR — olho do sujeito direito/esquerdo
const EAR_DIREITO = [33, 160, 158, 133, 153, 144] as const;
const EAR_ESQUERDO = [362, 385, 387, 263, 373, 380] as const;

class FonteMediaPipe {
  private earBase = 0;
  private cxAnt = -1;
  private cyAnt = -1;
  private tAnt = 0;

  private constructor(private readonly fl: FaceLandmarker) {}

  static async criar(o: OpcoesFonte): Promise<FonteMediaPipe> {
    const { FilesetResolver, FaceLandmarker: FL } = await import("@mediapipe/tasks-vision");
    const fileset = await comTimeout(
      FilesetResolver.forVisionTasks(o.caminhoWasm),
      o.timeoutMs,
      `Timeout carregando o runtime WASM em ${o.caminhoWasm}`,
    );

    let ultimoErro: Error = new Error("Nenhum delegate configurado");
    for (const delegate of o.delegates) {
      try {
        const fl = await comTimeout(
          FL.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: o.caminhoModelo, delegate },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
          o.timeoutMs,
          `Timeout criando o Face Landmarker (${delegate}) com ${o.caminhoModelo}`,
        );
        return new FonteMediaPipe(fl);
      } catch (e) {
        ultimoErro = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw ultimoErro;
  }

  fechar(): void {
    try {
      this.fl.close();
    } catch {
      /* noop */
    }
  }

  analisar(video: HTMLVideoElement, t: number): LeituraRosto {
    const semRosto = (motivo: MotivoRosto): LeituraRosto => ({
      rostoOk: false,
      motivo,
      fechamento: 0,
      fechamentoMin: 0,
      ear: 0,
      fonte: "blendshapes",
    });

    const res = this.fl.detectForVideo(video, t);
    const lm = res.faceLandmarks[0];
    if (!lm || lm.length < 400) {
      this.cxAnt = -1;
      return semRosto("SEM_ROSTO");
    }

    // Caixa do rosto (normalizada)
    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    for (const p of lm) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const larguraRel = ((maxX - minX) * vw) / Math.min(vw, vh);

    // Velocidade do centro (movimento brusco de cabeça corrompe landmarks dos olhos)
    let vel = 0;
    if (this.cxAnt >= 0 && t > this.tAnt) {
      vel = Math.hypot(cx - this.cxAnt, cy - this.cyAnt) / ((t - this.tAnt) / 1000);
    }
    this.cxAnt = cx;
    this.cyAnt = cy;
    this.tAnt = t;

    // Yaw aproximado: posição do nariz entre os cantos externos dos olhos (≈0.5 = de frente)
    const xo = lm[33]!.x;
    const xi = lm[263]!.x;
    const razaoYaw = (lm[1]!.x - xo) / (xi - xo || 1e-6);

    let motivo: MotivoRosto = "OK";
    if (larguraRel < 0.35) motivo = "LONGE";
    else if (larguraRel > 0.95) motivo = "PERTO";
    else if (Math.abs(cx - 0.5) > 0.2 || Math.abs(cy - 0.5) > 0.25) motivo = "FORA_DO_CENTRO";
    else if (razaoYaw < 0.3 || razaoYaw > 0.7) motivo = "DE_PERFIL";
    else if (vel > 0.8) motivo = "MOVIMENTO";

    // EAR real (em pixels) — usado como diagnóstico e como fallback
    const P = (i: number): Ponto2D => ({ x: lm[i]!.x * vw, y: lm[i]!.y * vh });
    const ear =
      (calcularEar(
        P(EAR_DIREITO[0]),
        P(EAR_DIREITO[1]),
        P(EAR_DIREITO[2]),
        P(EAR_DIREITO[3]),
        P(EAR_DIREITO[4]),
        P(EAR_DIREITO[5]),
      ) +
        calcularEar(
          P(EAR_ESQUERDO[0]),
          P(EAR_ESQUERDO[1]),
          P(EAR_ESQUERDO[2]),
          P(EAR_ESQUERDO[3]),
          P(EAR_ESQUERDO[4]),
          P(EAR_ESQUERDO[5]),
        )) /
      2;
    this.earBase =
      this.earBase === 0
        ? ear
        : ear >= this.earBase
          ? this.earBase * 0.9 + ear * 0.1
          : this.earBase * 0.998 + ear * 0.002;

    // Sinal principal: blendshapes (já normalizados 0–1, robustos a pose/óculos/iluminação)
    let bl = -1;
    let br = -1;
    for (const c of res.faceBlendshapes?.[0]?.categories ?? []) {
      if (c.categoryName === "eyeBlinkLeft") bl = c.score;
      else if (c.categoryName === "eyeBlinkRight") br = c.score;
    }

    let fechamento: number;
    let fechamentoMin: number;
    let fonte: "blendshapes" | "ear";
    if (bl >= 0 && br >= 0) {
      fechamento = (bl + br) / 2;
      fechamentoMin = Math.min(bl, br);
      fonte = "blendshapes";
    } else {
      fechamento = fechamentoMin = clamp((1 - ear / (this.earBase || ear || 1)) / 0.45, 0, 1);
      fonte = "ear";
    }

    return { rostoOk: motivo === "OK", motivo, fechamento, fechamentoMin, ear, fonte };
  }
}

/* ============================================================================
 * Camada 3 — Detector (câmera → fonte → máquina → callbacks)
 * ========================================================================== */

interface VideoRvfc {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
}

const agoraMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const INTERVALO_METRICAS_MS = 100;
const MAX_LADO_FOTO = 1280;

export class DetectorPiscadas {
  private readonly opts: OpcoesFonte;
  private readonly cb: Required<
    Pick<
      ConfigDetectorPiscada,
      | "onPiscada"
      | "onDuploPisqueConfirmado"
      | "onMelhorFrameCapturado"
      | "onReset"
      | "onEstadoOlhos"
      | "onEstado"
      | "onMetricas"
      | "onErro"
    >
  >;
  private readonly maquina: MaquinaPiscadas;

  private fonte: FonteMediaPipe | null = null;
  private video: HTMLVideoElement | null = null;
  private ativo = false;
  private token = 0;
  private handle: number | null = null;
  private usandoRvfc = false;
  private ultimoCurrentTime = -1;
  private ultimoTs = 0;
  private falhas = 0;

  private sessaoId = "";
  private estadoExterno: EstadoLiveness = "CARREGANDO";
  private ultimoEstadoOlhos: "calibrando" | "aberto" | "fechado" | null = null;
  private ultimaMetricaEm = 0;
  private ultimaLeitura: LeituraRosto | null = null;
  private inicioDesafio = 0;
  private earMin = 1;
  private baselineEar = 0;

  constructor(config: ConfigDetectorPiscada = {}) {
    this.opts = {
      caminhoWasm: config.caminhoWasm ?? "/mediapipe/wasm",
      caminhoModelo: config.caminhoModelo ?? "/mediapipe/face_landmarker.task",
      delegates: config.delegates ?? ["GPU", "CPU"],
      timeoutMs: config.timeoutCarregamentoMs ?? 12000,
    };
    this.cb = {
      onPiscada: config.onPiscada ?? (() => {}),
      onDuploPisqueConfirmado: config.onDuploPisqueConfirmado ?? (() => {}),
      onMelhorFrameCapturado: config.onMelhorFrameCapturado ?? (() => {}),
      onReset: config.onReset ?? (() => {}),
      onEstadoOlhos: config.onEstadoOlhos ?? (() => {}),
      onEstado: config.onEstado ?? (() => {}),
      onMetricas: config.onMetricas ?? (() => {}),
      onErro: config.onErro ?? (() => {}),
    };

    this.maquina = new MaquinaPiscadas(config.maquina, {
      onPiscada: (n) => this.cb.onPiscada(n),
      onReset: (m) => {
        this.inicioDesafio = 0;
        this.cb.onReset(m);
      },
      onEstado: (e) => {
        this.setEstado(e);
        if (e === "PISQUE_1" && this.inicioDesafio === 0) this.inicioDesafio = agoraMs();
        if (e === "AGUARDANDO_ROSTO") this.inicioDesafio = 0;
      },
      onCapturaPronta: () => {
        this.cb.onDuploPisqueConfirmado();
        this.capturarFotoFinal();
      },
    });

    this.gerarNovaSessao();
  }

  public gerarNovaSessao(): string {
    this.sessaoId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `live-${Date.now()}`;
    return this.sessaoId;
  }

  public getContagem(): number {
    return this.maquina.snapshot().contagem;
  }
  public getEstado(): EstadoLiveness {
    return this.estadoExterno;
  }
  public getSessaoId(): string {
    return this.sessaoId;
  }
  public get earAbertoBaseline(): number {
    return this.baselineEar;
  }

  /**
   * Carrega o modelo (com timeout e fallback GPU→CPU) e inicia a análise.
   * REJEITA a promise em caso de falha — trate na UI em vez de ficar eternamente "Calibrando...".
   */
  public async iniciar(video: HTMLVideoElement): Promise<void> {
    this.parar();
    const meuToken = ++this.token;
    this.video = video;
    this.ativo = true;
    this.setEstado("CARREGANDO");

    try {
      this.fonte ??= await FonteMediaPipe.criar(this.opts);
    } catch (e) {
      if (meuToken === this.token) this.falhar(e);
      throw e;
    }
    if (meuToken !== this.token) return; // parar()/iniciar() chamados durante o carregamento

    this.resetar();
    this.agendar();
  }

  public parar(): void {
    this.ativo = false;
    this.token++;
    const v = this.video as unknown as VideoRvfc | null;
    if (this.handle !== null) {
      if (this.usandoRvfc) v?.cancelVideoFrameCallback?.(this.handle);
      else cancelAnimationFrame(this.handle);
      this.handle = null;
    }
    this.video = null;
  }

  /** Libera WASM/GPU. Chame ao desmontar a tela. */
  public destruir(): void {
    this.parar();
    this.fonte?.fechar();
    this.fonte = null;
  }

  public resetar(): void {
    this.gerarNovaSessao();
    this.maquina.resetar();
    this.inicioDesafio = 0;
    this.earMin = 1;
    this.ultimoEstadoOlhos = null;
    this.setEstado("AGUARDANDO_ROSTO");
    this.emitirOlhos();
  }

  /* ---------------------------- loop ---------------------------- */

  private agendar(): void {
    if (!this.ativo || !this.video) return;
    const v = this.video as unknown as VideoRvfc;
    if (typeof v.requestVideoFrameCallback === "function") {
      // Processa somente quando há frame NOVO (economiza CPU/bateria, sem trabalho duplicado)
      this.usandoRvfc = true;
      this.handle = v.requestVideoFrameCallback(() => {
        this.handle = null;
        if (!this.ativo) return;
        this.tick();
        this.agendar();
      });
    } else {
      this.usandoRvfc = false;
      this.handle = requestAnimationFrame(() => {
        this.handle = null;
        if (!this.ativo) return;
        const vid = this.video;
        if (vid && vid.currentTime !== this.ultimoCurrentTime) {
          this.ultimoCurrentTime = vid.currentTime;
          this.tick();
        }
        this.agendar();
      });
    }
  }

  private tick(): void {
    const v = this.video;
    const f = this.fonte;
    if (!v || !f || v.readyState < 2 || v.videoWidth === 0) return;

    const ts = Math.max(agoraMs(), this.ultimoTs + 1); // MediaPipe exige timestamps estritamente crescentes
    this.ultimoTs = ts;

    let leitura: LeituraRosto;
    try {
      leitura = f.analisar(v, ts);
      this.falhas = 0;
    } catch (e) {
      if (++this.falhas >= 30) this.falhar(e);
      return;
    }
    this.ultimaLeitura = leitura;

    if (leitura.rostoOk) {
      this.baselineEar = Number(
        (this.baselineEar === 0
          ? leitura.ear
          : this.baselineEar * 0.95 + leitura.ear * 0.05
        ).toFixed(4),
      );
      const s0 = this.maquina.snapshot();
      if (s0.estado === "PISQUE_1" || s0.estado === "PISQUE_2")
        this.earMin = Math.min(this.earMin, leitura.ear);
    }

    const snap = this.maquina.processar({
      t: ts,
      rostoOk: leitura.rostoOk,
      fechamento: leitura.fechamento,
      fechamentoMin: leitura.fechamentoMin,
    });

    this.emitirOlhos(snap);
    if (ts - this.ultimaMetricaEm >= INTERVALO_METRICAS_MS) {
      this.ultimaMetricaEm = ts;
      this.cb.onMetricas({
        estado: this.estadoExterno,
        bilateralEar: Number(leitura.ear.toFixed(3)),
        earAbertoBaseline: Number(this.baselineEar.toFixed(3)),
        fechamento: Number(leitura.fechamento.toFixed(3)),
        contagemPiscadas: snap.contagem,
        duracaoPiscada1Ms: snap.duracoes[0] || undefined,
        duracaoPiscada2Ms: snap.duracoes[1] || undefined,
        faceEstavel: leitura.rostoOk,
        motivoRosto: leitura.motivo,
        sessaoId: this.sessaoId,
      });
    }
  }

  private emitirOlhos(snap = this.maquina.snapshot()): void {
    const calibrando = snap.estado === "AGUARDANDO_ROSTO" || snap.estado === "ESTABILIZANDO";
    const e = calibrando ? "calibrando" : snap.olhoFechado ? "fechado" : "aberto";
    if (e !== this.ultimoEstadoOlhos) {
      this.ultimoEstadoOlhos = e;
      this.cb.onEstadoOlhos(e);
    }
  }

  private setEstado(e: EstadoLiveness): void {
    if (e === this.estadoExterno) return;
    this.estadoExterno = e;
    this.cb.onEstado(e);
  }

  private falhar(e: unknown): void {
    this.ativo = false;
    this.setEstado("ERRO");
    this.cb.onErro(e instanceof Error ? e : new Error(String(e)));
  }

  /* ---------------------------- captura ---------------------------- */

  private capturarFotoFinal(): void {
    const v = this.video;
    if (!v || typeof document === "undefined") return;

    // Sem espelhar: a foto enviada é a imagem real da câmera (o espelho é só CSS no preview)
    const escala = Math.min(1, MAX_LADO_FOTO / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * escala);
    c.height = Math.round(v.videoHeight * escala);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const foto = c.toDataURL("image/jpeg", 0.85);

    const s = this.maquina.snapshot();
    const evidencia: EvidenciaLiveness = {
      sessaoId: this.sessaoId,
      desafioConcluido: true,
      duracaoTotalMs: Math.round(agoraMs() - (this.inicioDesafio || agoraMs())),
      earMedioAberto: Number(this.baselineEar.toFixed(3)),
      earMinimoFechado: Number(this.earMin.toFixed(3)),
      duracaoPiscada1Ms: s.duracoes[0],
      duracaoPiscada2Ms: s.duracoes[1],
      timestampConclusao: new Date().toISOString(),
      fonteSinal: this.ultimaLeitura?.fonte ?? "blendshapes",
    };
    this.cb.onMelhorFrameCapturado(foto, evidencia);
  }
}

/* ============================================================================
 * Sons — um único AudioContext (iOS limita instâncias e exige gesto do usuário)
 * ========================================================================== */

let audioCtx: AudioContext | null = null;

function obterAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx ??= new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Chame UMA vez dentro de um handler de toque (ex.: botão "Iniciar") para liberar áudio no iOS. */
export function desbloquearAudio(): void {
  const ctx = obterAudio();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

function tocarTom(
  passos: Array<[freq: number, atSec: number]>,
  volume: number,
  duracao: number,
  deslizar = false,
) {
  const ctx = obterAudio();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;
    osc.type = "sine";
    passos.forEach(([f, at], i) => {
      if (deslizar && i > 0) osc.frequency.exponentialRampToValueAtTime(f, t0 + at);
      else osc.frequency.setValueAtTime(f, t0 + at);
    });
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.01, t0 + duracao);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duracao + 0.01);
  } catch {
    /* áudio bloqueado: silencia */
  }
}

export const tocarSomObturador = () =>
  tocarTom(
    [
      [800, 0],
      [300, 0.08],
    ],
    0.3,
    0.08,
    true,
  );
export const tocarSomPiscada = () =>
  tocarTom(
    [
      [580, 0],
      [740, 0.05],
    ],
    0.18,
    0.1,
  );
export const tocarSomSucesso = () =>
  tocarTom(
    [
      [523.25, 0],
      [659.25, 0.07],
      [783.99, 0.14],
    ],
    0.2,
    0.25,
  );
