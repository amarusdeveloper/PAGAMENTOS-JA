import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FlipHorizontal,
  MapPin,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  SwitchCamera,
  User,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { LoadingBloco } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DetectorPiscadas,
  desbloquearAudio,
  tocarSomObturador,
  tocarSomPiscada,
  tocarSomSucesso,
  type EstadoLiveness,
  type EvidenciaLiveness,
  type MetricasLiveness,
} from "@/lib/detector-piscada";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  dataHora,
  formatarCpf,
  hora,
  ROTULO_TIPO_PONTO,
  soDigitos,
  type TipoPonto,
} from "@/lib/dominio";
import {
  confirmarPresenca,
  identificarNoPonto,
  obterContextoPonto,
  registrarPonto,
} from "@/lib/ponto.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ponto/$token")({
  head: () => ({
    meta: [
      { title: "Folha de Ponto Digital — Já por Swali" },
      {
        name: "description",
        content:
          "Registro eletrônico de ponto para freelancers e colaboradores em campo. Check-in, intervalo e saída via celular com validação por selfie e GPS.",
      },
      { property: "og:title", content: "Folha de Ponto Digital — Já por Swali" },
      {
        property: "og:description",
        content: "Check-in e check-out seguro da equipe de eventos pelo celular.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PaginaPonto,
});

const SEQUENCIA_COMPLETA: TipoPonto[] = ["entrada", "inicio_intervalo", "fim_intervalo", "saida"];

export function PaginaPonto() {
  const { token } = Route.useParams();
  const [cpf, setCpf] = useState("");
  const [identificado, setIdentificado] = useState<{
    escalaId: string;
    nome: string;
    statusEscala: string;
    pontos: {
      id: string;
      tipo: string;
      registrado_em: string;
      status: string;
      fora_horario: boolean;
    }[];
  } | null>(null);
  const [consentiuSelfie, setConsentiuSelfie] = useState(false);

  // Live real-time digital clock
  const [horaAtual, setHoraAtual] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setHoraAtual(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // In-app interactive selfie camera state
  const [cameraAberta, setCameraAberta] = useState(false);
  const [tipoPontoPendente, setTipoPontoPendente] = useState<TipoPonto | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [fotoCapturada, setFotoCapturada] = useState<string | null>(null);
  const [piscadasDetectadas, setPiscadasDetectadas] = useState<number>(0);
  const [espelhar, setEspelhar] = useState(false); // Inversão desativada por padrão conforme solicitado
  const [efeitoFlash, setEfeitoFlash] = useState(false);
  const [estadoOlhos, setEstadoOlhos] = useState<"calibrando" | "aberto" | "fechado">("calibrando");
  const [tempoRestanteDuploPisque, setTempoRestanteDuploPisque] = useState<number>(100);
  const [evidenciaLiveness, setEvidenciaLiveness] = useState<EvidenciaLiveness | null>(null);
  const [estadoLiveness, setEstadoLiveness] = useState<EstadoLiveness>("WAITING_FOR_FACE");
  const [metricasLiveness, setMetricasLiveness] = useState<MetricasLiveness | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<DetectorPiscadas | null>(null);
  const timerJanelaRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerJanelaRef.current !== null) {
        clearInterval(timerJanelaRef.current);
        timerJanelaRef.current = null;
      }
      if (detectorRef.current) {
        detectorRef.current.parar();
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [cameraStream]);

  const obterCtx = useServerFn(obterContextoPonto);
  const identificarFn = useServerFn(identificarNoPonto);
  const confirmarFn = useServerFn(confirmarPresenca);
  const registrarFn = useServerFn(registrarPonto);

  const contexto = useQuery({
    queryKey: ["ponto-contexto", token],
    queryFn: () => obterCtx({ data: { token } }),
    retry: false,
  });

  const identificar = useMutation({
    mutationFn: () => identificarFn({ data: { token, cpf: soDigitos(cpf) } }),
    onSuccess: (d) => {
      setIdentificado(d);
      toast.success(`Olá, ${d.nome.split(" ")[0]}! Escala identificada.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmar = useMutation({
    mutationFn: () => confirmarFn({ data: { token, cpf: soDigitos(cpf) } }),
    onSuccess: () => {
      toast.success("Presença confirmada no evento.");
      identificar.mutate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Geolocation state
  const [coordenadasGps, setCoordenadasGps] = useState<{ lat: number; lng: number } | null>(null);
  const [statusGps, setStatusGps] = useState<"ocioso" | "solicitando" | "obtido" | "negado">(
    "ocioso",
  );

  async function solicitarLocalizacao(
    silencioso = false,
  ): Promise<{ lat: number; lng: number } | null> {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (!silencioso) toast.error("Seu navegador não suporta geolocalização.");
      return null;
    }
    setStatusGps("solicitando");
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, rej, {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 60_000,
        });
      });
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoordenadasGps(coords);
      setStatusGps("obtido");
      if (!silencioso) toast.success("Localização GPS capturada com sucesso!");
      return coords;
    } catch {
      setStatusGps("negado");
      if (!silencioso) {
        toast.error("Permissão de localização negada. Ative o GPS no navegador do celular.");
      }
      return null;
    }
  }

  // Proativamente solicita permissão de GPS assim que a escala for identificada
  useEffect(() => {
    if (identificado && statusGps === "ocioso") {
      void solicitarLocalizacao(true);
    }
  }, [identificado, statusGps]);

  const registrar = useMutation({
    mutationFn: async ({
      tipo,
      fotoBase64,
      evidencia,
    }: {
      tipo: TipoPonto;
      fotoBase64: string | null;
      evidencia?: EvidenciaLiveness | null;
    }) => {
      if (!identificado) throw new Error("Identifique-se novamente com seu CPF.");

      let lat: number | null = coordenadasGps?.lat ?? null;
      let lng: number | null = coordenadasGps?.lng ?? null;

      if (lat === null || lng === null) {
        const obtido = await solicitarLocalizacao(false);
        if (obtido) {
          lat = obtido.lat;
          lng = obtido.lng;
        } else if (contexto.data?.exigeGps) {
          throw new Error(
            "Não foi possível obter sua localização GPS. Ative a localização no seu navegador.",
          );
        }
      }

      return registrarFn({
        data: {
          token,
          cpf: soDigitos(cpf),
          escalaId: identificado.escalaId,
          tipo,
          fotoBase64,
          lat,
          lng,
          consentiuSelfie,
          evidenciaLiveness: evidencia ?? undefined,
        },
      });
    },
    onSuccess: (resultado) => {
      fecharCamera();
      toast.success(
        resultado.foraHorario
          ? "Ponto registrado fora do horário e enviado para aprovação da supervisão."
          : "Ponto registrado com sucesso! Aguarde a conferência da equipe.",
      );
      identificar.mutate();
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  function limparTimerJanela() {
    if (timerJanelaRef.current !== null) {
      clearInterval(timerJanelaRef.current);
      timerJanelaRef.current = null;
    }
    setTempoRestanteDuploPisque(100);
  }

  const capturarFoto = useCallback(() => {
    if (!videoRef.current) return;
    if (detectorRef.current) {
      detectorRef.current.parar();
      detectorRef.current = null;
    }
    const v = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 640;
    canvas.height = v.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (espelhar) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
    setFotoCapturada(dataUrl);
    tocarSomObturador();
    setEfeitoFlash(true);
    setTimeout(() => setEfeitoFlash(false), 200);
  }, [espelhar]);

  const iniciarDetectorPiscadas = useCallback(() => {
    if (!videoRef.current) return;
    if (detectorRef.current) {
      detectorRef.current.parar();
      detectorRef.current = null;
    }
    limparTimerJanela();

    const detector = new DetectorPiscadas({
      caminhoWasm: "/mediapipe/wasm",
      caminhoModelo: "/mediapipe/face_landmarker.task",
      delegates: ["GPU", "CPU"],
      timeoutCarregamentoMs: 12000,
      onPiscada: (numero) => {
        setPiscadasDetectadas(numero);
        if (numero === 1) {
          tocarSomPiscada();
          // Inicia contagem regressiva da janela permissiva para a 2ª piscada (4000ms)
          limparTimerJanela();
          const inicio = Date.now();
          const duracao = 4000;
          timerJanelaRef.current = window.setInterval(() => {
            const decorrido = Date.now() - inicio;
            const restante = Math.max(0, 100 - (decorrido / duracao) * 100);
            setTempoRestanteDuploPisque(restante);
            if (restante <= 0) {
              limparTimerJanela();
            }
          }, 40);
        } else if (numero === 2) {
          limparTimerJanela();
        }

        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            navigator.vibrate(numero === 1 ? 40 : [50, 30, 80]);
          } catch {
            // vibração opcional
          }
        }
      },
      onDuploPisqueConfirmado: () => {
        limparTimerJanela();
        setPiscadasDetectadas(2);
        tocarSomSucesso();
      },
      onMelhorFrameCapturado: (fotoBase64, evidencia) => {
        limparTimerJanela();
        if (detectorRef.current) {
          detectorRef.current.parar();
          detectorRef.current = null;
        }
        setPiscadasDetectadas(2);
        setFotoCapturada(fotoBase64);
        setEvidenciaLiveness(evidencia);
        tocarSomObturador();
        setEfeitoFlash(true);
        setTimeout(() => setEfeitoFlash(false), 200);
        toast.success("Vivacidade aprovada! Foto capturada automaticamente.");
      },
      onReset: (motivo) => {
        limparTimerJanela();
        setPiscadasDetectadas(0);
        if (motivo === "intervalo") {
          toast.info("Tempo entre piscadas expirou. Pisque 2 vezes novamente.");
        }
      },
      onEstadoOlhos: (estado) => {
        setEstadoOlhos(estado);
      },
      onEstado: (estado) => {
        setEstadoLiveness(estado);
      },
      onMetricas: (m) => {
        setMetricasLiveness(m);
      },
      onErro: (err) => {
        console.error("Falha no detector de vivacidade:", err);
        toast.error("Falha ao inicializar o detector de vivacidade facial.");
      },
    });
    detectorRef.current = detector;
    void detector.iniciar(videoRef.current).catch((err) => {
      console.warn("Erro ao iniciar câmera no detector:", err);
    });
  }, []);

  // Sincroniza e garante o stream e o detector assim que o elemento <video> for montado
  useEffect(() => {
    if (!cameraAberta || !cameraStream) return;
    const v = videoRef.current;
    if (!v) return;

    if (v.srcObject !== cameraStream) {
      v.srcObject = cameraStream;
    }

    const iniciarAoCarregar = () => {
      v.play().catch(() => {});
      iniciarDetectorPiscadas();
    };

    v.addEventListener("loadedmetadata", iniciarAoCarregar);
    v.addEventListener("canplay", iniciarAoCarregar);

    v.play().catch(() => {});

    if (v.readyState >= 1) {
      iniciarDetectorPiscadas();
    }

    return () => {
      v.removeEventListener("loadedmetadata", iniciarAoCarregar);
      v.removeEventListener("canplay", iniciarAoCarregar);
    };
  }, [cameraStream, cameraAberta, iniciarDetectorPiscadas]);

  async function iniciarCamera(modo: "user" | "environment" = facingMode) {
    if (!window.isSecureContext) {
      toast.error("A câmera só funciona em conexão segura (HTTPS).");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Seu navegador não suporta captura direta de câmera.");
      return;
    }
    try {
      if (detectorRef.current) {
        detectorRef.current.parar();
        detectorRef.current = null;
      }
      limparTimerJanela();
      setPiscadasDetectadas(0);
      setEstadoOlhos("calibrando");
      setEstadoLiveness("WAITING_FOR_FACE");
      setMetricasLiveness(null);
      setEvidenciaLiveness(null);
      if (cameraStream) {
        cameraStream.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: modo }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        iniciarDetectorPiscadas();
      }
    } catch {
      toast.error("Permita o acesso à câmera nas configurações do navegador para continuar.");
    }
  }

  function fecharCamera() {
    limparTimerJanela();
    if (detectorRef.current) {
      detectorRef.current.destruir();
      detectorRef.current = null;
    }
    setPiscadasDetectadas(0);
    setEstadoOlhos("calibrando");
    setEstadoLiveness("AGUARDANDO_ROSTO");
    setMetricasLiveness(null);
    setEvidenciaLiveness(null);
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
    setCameraAberta(false);
    setFotoCapturada(null);
    setTipoPontoPendente(null);
  }

  function alternarCamera() {
    limparTimerJanela();
    if (detectorRef.current) {
      detectorRef.current.parar();
      detectorRef.current = null;
    }
    setPiscadasDetectadas(0);
    const proximo = facingMode === "user" ? "environment" : "user";
    setFacingMode(proximo);
    void iniciarCamera(proximo);
  }

  function prepararPonto(tipo: TipoPonto) {
    desbloquearAudio();
    if (!coordenadasGps) {
      void solicitarLocalizacao(true);
    }
    if (contexto.data?.exigeSelfie) {
      if (!consentiuSelfie) {
        toast.error("Marque a autorização da selfie antes de registrar o ponto.");
        return;
      }
      setTipoPontoPendente(tipo);
      setCameraAberta(true);
      void iniciarCamera(facingMode);
    } else {
      registrar.mutate({ tipo, fotoBase64: null });
    }
  }

  function reiniciarIdentificacao() {
    setIdentificado(null);
    setCpf("");
    setConsentiuSelfie(false);
  }

  if (contexto.isPending) {
    return (
      <main className="mx-auto max-w-md p-6 min-h-screen flex flex-col justify-center">
        <LoadingBloco linhas={5} />
      </main>
    );
  }

  if (contexto.isError) {
    return (
      <main className="mx-auto max-w-md p-6 min-h-screen flex flex-col items-center justify-center text-center">
        <div className="size-14 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-4">
          <AlertCircle className="size-7" />
        </div>
        <h1 className="text-xl font-bold text-foreground">QR Code Inválido ou Expirado</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {contexto.error?.message ||
            "Este código de ponto não está mais ativo ou ultrapassou a janela máxima de 12 horas."}
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Solicite ao supervisor do evento para abrir o painel e clicar em &quot;Trocar QR&quot;
          para renovar o código ativo.
        </p>
        <Button variant="outline" size="sm" className="mt-6" onClick={() => contexto.refetch()}>
          <RefreshCw className="size-3.5 mr-1.5" />
          Tentar novamente
        </Button>
      </main>
    );
  }

  const ctx = contexto.data;
  const validos = identificado?.pontos.filter((p) => p.status !== "recusado") ?? [];
  const sequencia: TipoPonto[] = ctx.pontoBasico ? ["entrada", "saida"] : SEQUENCIA_COMPLETA;
  const proximoTipo = sequencia[validos.length] ?? null;

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-border bg-card/90 backdrop-blur-md sticky top-0 z-10 px-4 py-3">
        <div className="mx-auto max-w-md flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-black text-base text-foreground tracking-tight">Já</span>
            <span className="text-[10px] text-muted-foreground font-medium border-l border-border pl-2">
              Folha de Ponto
            </span>
          </div>
          <a
            href="https://www.swali.com.br/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
          >
            <Sparkles className="size-3" />
            <span>Swali SaaS</span>
          </a>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-md w-full p-4 space-y-4 flex-1">
        {/* Event Card with Live Clock */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-xs space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="inline-block rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary mb-1">
                Evento em Andamento
              </span>
              <h1 className="text-lg font-bold text-foreground leading-tight">{ctx.evento.nome}</h1>
              {ctx.evento.local ? (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <MapPin className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{ctx.evento.local}</span>
                </p>
              ) : null}
            </div>

            {/* Live Clock Display */}
            <div className="text-right shrink-0">
              <div className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-xs font-mono font-bold text-foreground">
                <Clock className="size-3.5 text-primary" />
                <span>
                  {horaAtual.toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Horário de Brasília</p>
            </div>
          </div>

          {ctx.evento.qr_code_expira_em ? (
            <p className="text-[11px] text-muted-foreground/80 border-t border-border/60 pt-2 flex items-center gap-1">
              <span>QR Code ativo até: {dataHora(ctx.evento.qr_code_expira_em)}</span>
            </p>
          ) : null}
        </section>

        {/* STEP 1: Identification by CPF */}
        {!identificado ? (
          <section className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <User className="size-4 text-primary" />
                Identificação do Colaborador
              </h2>
              <p className="text-xs text-muted-foreground">
                Digite seu CPF para carregar sua escala e liberar os registros de ponto.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (soDigitos(cpf).length !== 11) {
                  toast.error("Informe os 11 dígitos do seu CPF.");
                  return;
                }
                identificar.mutate();
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="cpf-ponto" className="text-xs font-medium">
                  CPF cadastrado
                </Label>
                <Input
                  id="cpf-ponto"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                  className="h-12 text-base font-mono tracking-wider"
                  value={formatarCpf(cpf)}
                  onChange={(e) => setCpf(soDigitos(e.target.value).slice(0, 11))}
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-sm font-semibold"
                disabled={identificar.isPending || soDigitos(cpf).length < 11}
              >
                {identificar.isPending ? (
                  <>
                    <RefreshCw className="size-4 mr-2 animate-spin" />
                    Consultando escala...
                  </>
                ) : (
                  <>
                    Acessar Folha de Ponto
                    <Check className="size-4 ml-1.5" />
                  </>
                )}
              </Button>
            </form>

            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-primary" />
                Sem necessidade de login ou senha
              </p>
              <p>
                Basta ter o CPF cadastrado pela agência e estar escalado na equipe deste evento.
              </p>
            </div>
          </section>
        ) : (
          /* STEP 2: Workday & Punch-in Controls */
          <div className="space-y-4">
            {/* User identified banner */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3.5 shadow-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                  {identificado.nome.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">{identificado.nome}</p>
                  <p className="text-xs text-muted-foreground">Escala vinculada</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={identificado.statusEscala} />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={reiniciarIdentificacao}
                  title="Trocar colaborador"
                >
                  <RotateCcw className="size-3.5 mr-1" />
                  Sair
                </Button>
              </div>
            </div>

            {/* If presence confirmation is needed */}
            {identificado.statusEscala === "convidado" ? (
              <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <UserCheck className="size-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Confirmação de Presença</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Você foi convidado para a equipe deste evento. Confirme sua presença para
                      liberar os botões de ponto.
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full h-11 font-semibold"
                  onClick={() => confirmar.mutate()}
                  disabled={confirmar.isPending}
                >
                  {confirmar.isPending ? "Confirmando..." : "Confirmar Minha Presença"}
                </Button>
              </section>
            ) : (
              /* Workday Stepper & Action Controls */
              <section className="rounded-xl border border-border bg-card p-4 shadow-xs space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-foreground">Jornada de Trabalho Hoje</h2>
                  <p className="text-xs text-muted-foreground">
                    Acompanhe o fluxo sequencial das marcações obrigatórias.
                  </p>
                </div>

                {/* Visual Workday Stepper */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {sequencia.map((tipo, idx) => {
                    const registroFeito = validos.find((p) => p.tipo === tipo);
                    const isAtual = tipo === proximoTipo;
                    return (
                      <div
                        key={tipo}
                        className={cn(
                          "rounded-lg border p-2.5 text-center transition-all flex flex-col justify-between gap-1",
                          registroFeito
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : isAtual
                              ? "border-primary bg-primary/10 text-primary font-semibold ring-2 ring-primary/20 shadow-xs"
                              : "border-border bg-muted/30 text-muted-foreground opacity-60",
                        )}
                      >
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-bold">{idx + 1}º</span>
                          {registroFeito ? (
                            <CheckCircle2 className="size-3.5 text-emerald-600" />
                          ) : isAtual ? (
                            <span className="size-2 rounded-full bg-primary animate-ping" />
                          ) : null}
                        </div>
                        <p className="text-xs font-semibold leading-tight mt-1">
                          {ROTULO_TIPO_PONTO[tipo]}
                        </p>
                        <p className="text-[10px] font-mono mt-0.5">
                          {registroFeito
                            ? hora(registroFeito.registrado_em)
                            : isAtual
                              ? "Aguardando"
                              : "Pendente"}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Consent checkbox for Selfie if required */}
                {ctx.exigeSelfie ? (
                  <label className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox
                      checked={consentiuSelfie}
                      onCheckedChange={(checked) => setConsentiuSelfie(checked === true)}
                      aria-label="Autorizar uso da selfie para conferência de presença"
                      className="mt-0.5"
                    />
                    <span className="leading-relaxed">
                      <strong>Termo de Evidência Fotográfica:</strong> Autorizo a selfie para fins
                      exclusivos de conferência e auditoria humana do ponto pela supervisão, com
                      exclusão automática no prazo de retenção da agência.
                    </span>
                  </label>
                ) : null}

                {/* GPS Location Status & Request Card */}
                <div className="rounded-xl border border-border bg-card p-3 shadow-xs space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <MapPin
                        className={cn(
                          "size-4",
                          coordenadasGps ? "text-emerald-500" : "text-rose-500",
                        )}
                      />
                      Localização GPS do Aparelho
                    </span>
                    {coordenadasGps ? (
                      <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                        Ativa ({coordenadasGps.lat.toFixed(4)}, {coordenadasGps.lng.toFixed(4)})
                      </span>
                    ) : statusGps === "solicitando" ? (
                      <span className="text-[11px] text-primary flex items-center gap-1 font-medium">
                        <RefreshCw className="size-3 animate-spin" /> Solicitando...
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full font-medium">
                        Pendente
                      </span>
                    )}
                  </div>

                  {coordenadasGps ? (
                    <p className="text-[11px] text-muted-foreground">
                      Sua coordenada geográfica será vinculada à marcação do ponto para auditoria da
                      supervisão.
                    </p>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1">
                      <p className="text-[11px] text-muted-foreground">
                        Permita o acesso à localização do celular para validar sua presença no
                        evento.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-semibold border-rose-500/30 text-rose-600 hover:bg-rose-500/10 shrink-0"
                        onClick={() => void solicitarLocalizacao(false)}
                      >
                        <MapPin className="size-3.5 mr-1" /> Permitir Localização
                      </Button>
                    </div>
                  )}
                </div>

                {/* Big Primary Punch Action Button */}
                {proximoTipo ? (
                  <div className="pt-2">
                    <Button
                      size="lg"
                      className="w-full h-14 text-base font-bold shadow-md flex items-center justify-center gap-2 touch-manipulation"
                      disabled={registrar.isPending || (ctx.exigeSelfie && !consentiuSelfie)}
                      onClick={() => prepararPonto(proximoTipo)}
                    >
                      <Camera className="size-5" />
                      <span>Registrar {ROTULO_TIPO_PONTO[proximoTipo]}</span>
                    </Button>
                    {ctx.exigeSelfie && !consentiuSelfie ? (
                      <p className="mt-1.5 text-center text-[11px] text-amber-600 dark:text-amber-400">
                        Marque a caixa acima concordando com a selfie para habilitar o registro.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4 text-center">
                    <CheckCircle2 className="size-6 text-emerald-600 mx-auto mb-1" />
                    <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
                      Jornada concluída!
                    </p>
                    <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">
                      Todos os registros previstos para este evento foram enviados.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* List of Registered Records */}
            <section className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
              <div className="border-b border-border px-4 py-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">Histórico de Batidas Hoje</h3>
                <span className="text-xs text-muted-foreground">
                  {identificado.pontos.length} registro(s)
                </span>
              </div>

              {identificado.pontos.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                  Nenhum registro de ponto computado até o momento.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {[...identificado.pontos]
                    .sort(
                      (a, b) =>
                        new Date(b.registrado_em).getTime() - new Date(a.registrado_em).getTime(),
                    )
                    .map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between px-4 py-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <p className="font-semibold text-foreground text-sm">
                            {ROTULO_TIPO_PONTO[p.tipo as TipoPonto] ?? p.tipo}
                          </p>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span>Horário: {hora(p.registrado_em)}</span>
                            {p.fora_horario ? (
                              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                Fora do horário
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <StatusBadge status={p.status} />
                      </li>
                    ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>

      {/* In-App Camera Viewfinder Dialog */}
      <Dialog open={cameraAberta} onOpenChange={(aberto) => !aberto && fecharCamera()}>
        <DialogContent className="max-w-md p-4 sm:p-6 overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Camera className="size-4 text-primary" />
              Evidência de Ponto: {tipoPontoPendente ? ROTULO_TIPO_PONTO[tipoPontoPendente] : ""}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Mantenha o rosto enquadrado na tela para a conferência humana da supervisão.
            </DialogDescription>
          </DialogHeader>

          <div className="relative aspect-3/4 max-h-[60vh] w-full bg-black rounded-xl overflow-hidden flex items-center justify-center">
            {fotoCapturada ? (
              <img
                src={fotoCapturada}
                alt="Selfie capturada"
                className="w-full h-full object-cover"
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={cn(
                    "w-full h-full object-cover transition-transform duration-200",
                    espelhar && "-scale-x-100",
                  )}
                />

                {/* Flash shutter animation */}
                {efeitoFlash && (
                  <div className="pointer-events-none absolute inset-0 bg-white z-30 animate-out fade-out duration-200" />
                )}

                {/* Liveness State Machine & EAR Interactive Badge */}
                <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 px-3 py-1.5 rounded-2xl bg-black/75 backdrop-blur-md text-white text-xs font-medium border border-white/10 shadow-lg max-w-[calc(100%-110px)]">
                  <div className="flex items-center gap-1.5">
                    <Eye
                      className={cn(
                        "size-3.5 transition-colors shrink-0",
                        piscadasDetectadas >= 1
                          ? "text-emerald-400 animate-pulse"
                          : estadoLiveness === "WAITING_FOR_FACE"
                            ? "text-white/50"
                            : estadoOlhos === "fechado"
                              ? "text-amber-400"
                              : "text-emerald-300",
                      )}
                    />
                    <span className="truncate">
                      {piscadasDetectadas === 1 && "1/2 confirmada! Dê a 2ª piscada..."}
                      {piscadasDetectadas >= 2 && "2/2 confirmada! Capturando..."}
                      {piscadasDetectadas === 0 &&
                        (metricasLiveness?.motivoRosto === "LONGE"
                          ? "Aproxime o rosto da tela"
                          : metricasLiveness?.motivoRosto === "PERTO"
                            ? "Afaste um pouco o rosto"
                            : metricasLiveness?.motivoRosto === "FORA_DO_CENTRO"
                              ? "Centralize o rosto na demarcação"
                              : metricasLiveness?.motivoRosto === "DE_PERFIL"
                                ? "Olhe de frente para a câmera"
                                : metricasLiveness?.motivoRosto === "MOVIMENTO"
                                  ? "Mantenha o rosto parado"
                                  : estadoLiveness === "CARREGANDO"
                                    ? "Iniciando detecção facial..."
                                    : estadoLiveness === "AGUARDANDO_ROSTO" ||
                                        metricasLiveness?.motivoRosto === "SEM_ROSTO"
                                      ? "Posicione o rosto na tela"
                                      : estadoLiveness === "ESTABILIZANDO"
                                        ? "Rosto detectado · Estabilizando..."
                                        : estadoOlhos === "fechado"
                                          ? "Detectando fechamento..."
                                          : "Pisque 2x para capturar")}
                    </span>
                    <div className="flex items-center gap-1 ml-auto shrink-0">
                      <span
                        className={cn(
                          "size-2 rounded-full transition-all",
                          piscadasDetectadas >= 1
                            ? "bg-emerald-400 scale-125 shadow-xs shadow-emerald-400/50"
                            : "bg-white/30",
                        )}
                      />
                      <span
                        className={cn(
                          "size-2 rounded-full transition-all",
                          piscadasDetectadas >= 2
                            ? "bg-emerald-400 scale-125 shadow-xs shadow-emerald-400/50"
                            : "bg-white/30",
                        )}
                      />
                    </div>
                  </div>
                  {/* Barra de progresso para a 2ª piscada */}
                  {piscadasDetectadas === 1 && (
                    <div className="w-full bg-white/20 h-1 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-400 h-full transition-all duration-75"
                        style={{ width: `${tempoRestanteDuploPisque}%` }}
                      />
                    </div>
                  )}
                  {/* Telemetria do EAR em tempo real */}
                  {metricasLiveness && (
                    <div className="flex items-center justify-between text-[10px] text-white/70 pt-0.5 border-t border-white/10 font-mono">
                      <span>EAR: {metricasLiveness.bilateralEar.toFixed(2)}</span>
                      <span>Base: {metricasLiveness.earAbertoBaseline.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {/* Top Right Controls: Sem inverter / Espelhar + Trocar câmera */}
                <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 rounded-full bg-black/65 backdrop-blur-md text-white hover:bg-black/85 text-xs px-2.5 gap-1.5 border border-white/10 shadow-lg"
                    onClick={() => setEspelhar((prev) => !prev)}
                    title={
                      espelhar ? "Foto espelhada ativa" : "Foto sem inverter (modo real) ativa"
                    }
                  >
                    <FlipHorizontal className="size-3.5" />
                    <span className="hidden sm:inline">
                      {espelhar ? "Espelhado" : "Sem inverter"}
                    </span>
                  </Button>

                  <Button
                    size="icon"
                    variant="secondary"
                    className="size-8 rounded-full bg-black/65 backdrop-blur-md text-white hover:bg-black/85 border border-white/10 shadow-lg"
                    onClick={alternarCamera}
                    title="Alternar entre câmera frontal e traseira"
                  >
                    <SwitchCamera className="size-3.5" />
                  </Button>
                </div>

                {/* Oval face guide overlay with eye alignment guide */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div
                    className={cn(
                      "relative w-56 h-72 border-2 border-dashed rounded-full shadow-2xl transition-all duration-300",
                      piscadasDetectadas === 1
                        ? "border-emerald-400 bg-emerald-500/10 ring-4 ring-emerald-400/20"
                        : piscadasDetectadas >= 2
                          ? "border-emerald-400 bg-emerald-500/20 ring-8 ring-emerald-400/30"
                          : estadoOlhos === "fechado"
                            ? "border-amber-400/80 bg-amber-500/5"
                            : "border-white/60",
                    )}
                  >
                    {/* Guia flexível de enquadramento facial */}
                    <div className="absolute top-[38%] inset-x-6 flex items-center justify-between opacity-70">
                      <div className="w-8 h-4 border-b-2 border-dashed border-white/60 rounded-b-full" />
                      <span className="text-[10px] text-white font-medium tracking-wide bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-xs">
                        {piscadasDetectadas === 1 ? "1/2 OK · Pisque de novo" : "Rosto visível"}
                      </span>
                      <div className="w-8 h-4 border-b-2 border-dashed border-white/60 rounded-b-full" />
                    </div>
                  </div>
                </div>

                {/* Guidance badge under the oval */}
                <div className="pointer-events-none absolute bottom-3 inset-x-0 flex justify-center z-10 px-3">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-md text-white text-[11px] border border-white/10 shadow-md">
                    <Sparkles className="size-3 text-amber-400 shrink-0" />
                    <span>
                      {piscadasDetectadas === 0 && "Mantenha o rosto visível e pisque 2 vezes"}
                      {piscadasDetectadas === 1 && "1/2 confirmada! Dê a 2ª piscada rápida"}
                      {piscadasDetectadas >= 2 && "Foto capturada automaticamente!"}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
            {fotoCapturada ? (
              <>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    setFotoCapturada(null);
                    setEvidenciaLiveness(null);
                    setPiscadasDetectadas(0);
                    void iniciarCamera(facingMode);
                  }}
                  disabled={registrar.isPending}
                >
                  <RotateCcw className="size-4 mr-1.5" />
                  Repetir foto
                </Button>
                <Button
                  className="w-full sm:w-auto font-semibold"
                  disabled={registrar.isPending || !tipoPontoPendente}
                  onClick={() => {
                    if (tipoPontoPendente && fotoCapturada) {
                      registrar.mutate({
                        tipo: tipoPontoPendente,
                        fotoBase64: fotoCapturada,
                        evidencia: evidenciaLiveness,
                      });
                    }
                  }}
                >
                  {registrar.isPending ? "Gravando ponto..." : "Confirmar e Gravar Ponto"}
                </Button>
              </>
            ) : (
              <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fecharCamera}
                  className="w-full sm:w-auto"
                >
                  Cancelar
                </Button>
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium text-center sm:text-right">
                  <Eye className="size-4 text-primary animate-pulse shrink-0" />
                  <span>
                    {piscadasDetectadas === 0 && "Pisque 2 vezes para disparar"}
                    {piscadasDetectadas === 1 && "1ª piscada detectada! Pisque mais 1 vez..."}
                    {piscadasDetectadas >= 2 && "2ª piscada! Processando..."}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={capturarFoto}
                  className="w-full sm:w-auto font-medium"
                >
                  <Camera className="size-3.5 mr-1.5" />
                  Capturar Foto
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Footer Branding */}
      <footer className="border-t border-border bg-card/60 py-4 px-4 text-center text-xs text-muted-foreground space-y-1">
        <p>
          Já — Gestão de Equipes e Pagamentos por{" "}
          <a
            href="https://www.swali.com.br/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-foreground underline decoration-primary/50 hover:text-primary transition-colors"
          >
            Swali Tecnologia (swali.com.br)
          </a>
        </p>
        <p className="text-[10px] text-muted-foreground/75">
          Auditoria de ponto eletrônico • Controle em tempo real para eventos e operações
        </p>
      </footer>
    </div>
  );
}
