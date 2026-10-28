import fs from "node:fs";
import path from "node:path";

export interface EscalaSessao {
  escalaId: string;
  equipeId: string;
  freelancerId: string;
  nome: string;
  cpf: string;
  status: string;
}

export interface PontoSessao {
  id: string;
  escalaId: string;
  tipo: string;
  registrado_em: string;
  status: string;
  fora_horario: boolean;
  foto_url?: string | null | undefined;
  gps_lat?: number | null | undefined;
  gps_lng?: number | null | undefined;
}

export interface SessaoEventoPonto {
  eventoId: string;
  empresaId: string;
  qrCodeToken: string;
  signedToken?: string;
  nome: string;
  local?: string | null;
  status?: string | null;
  data_inicio: string;
  data_fim?: string | null;
  qr_code_expira_em?: string | null;
  exigeSelfie: boolean;
  exigeGps: boolean;
  pontoBasico: boolean;
  authHeader?: string | null;
  escalas: EscalaSessao[];
  pontos: PontoSessao[];
  atualizadoEm: number;
  expiraEm: number;
}

const STORE_FILE = path.join("/tmp", "ponto-store.json");

// Cache em memória
const sessoesPorToken = new Map<string, SessaoEventoPonto>();
const sessoesPorEventoId = new Map<string, SessaoEventoPonto>();

// Carrega dados iniciais do disco
function carregarDoDisco(): void {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      const list = JSON.parse(raw) as SessaoEventoPonto[];
      const agora = Date.now();
      for (const item of list) {
        // Ignora apenas sessões expiradas há mais de 2 dias
        if (agora - item.expiraEm < 48 * 60 * 60_000) {
          if (item.qrCodeToken) sessoesPorToken.set(item.qrCodeToken, item);
          if (item.signedToken) sessoesPorToken.set(item.signedToken, item);
          if (item.eventoId) sessoesPorEventoId.set(item.eventoId, item);
        }
      }
    }
  } catch {
    // Ignora falha de parse
  }
}

function salvarNoDisco(): void {
  try {
    const unicas = Array.from(sessoesPorEventoId.values());
    fs.writeFileSync(STORE_FILE, JSON.stringify(unicas, null, 2), "utf8");
  } catch {
    // Não-bloqueante
  }
}

// Inicializa na carga do módulo
carregarDoDisco();

export function salvarSessaoEvento(
  dados: Omit<SessaoEventoPonto, "atualizadoEm" | "pontos"> & {
    pontos?: PontoSessao[];
    atualizadoEm?: number;
  },
): SessaoEventoPonto {
  const agora = Date.now();
  const existente =
    sessoesPorEventoId.get(dados.eventoId) ||
    sessoesPorToken.get(dados.qrCodeToken) ||
    (dados.signedToken ? sessoesPorToken.get(dados.signedToken) : undefined);

  // Mantém pontos já registrados caso existam
  const pontos = dados.pontos ?? existente?.pontos ?? [];

  const sessaoCompleta: SessaoEventoPonto = {
    ...existente,
    ...dados,
    pontos,
    atualizadoEm: agora,
    expiraEm: dados.expiraEm || agora + 24 * 60 * 60_000,
  };

  if (sessaoCompleta.qrCodeToken) {
    sessoesPorToken.set(sessaoCompleta.qrCodeToken, sessaoCompleta);
  }
  if (sessaoCompleta.signedToken) {
    sessoesPorToken.set(sessaoCompleta.signedToken, sessaoCompleta);
  }
  if (sessaoCompleta.eventoId) {
    sessoesPorEventoId.set(sessaoCompleta.eventoId, sessaoCompleta);
  }

  salvarNoDisco();
  return sessaoCompleta;
}

export function buscarSessaoEventoPorToken(token: string): SessaoEventoPonto | null {
  if (!token) return null;
  const sessao = sessoesPorToken.get(token) || sessoesPorEventoId.get(token);
  if (sessao) {
    return sessao;
  }
  return null;
}

export function buscarSessaoPorEventoId(eventoId: string): SessaoEventoPonto | null {
  return sessoesPorEventoId.get(eventoId) ?? null;
}

export function adicionarPontoSessao(tokenOuEventoId: string, ponto: PontoSessao): void {
  const sessao = sessoesPorToken.get(tokenOuEventoId) || sessoesPorEventoId.get(tokenOuEventoId);
  if (!sessao) return;

  const idx = sessao.pontos.findIndex((p) => p.id === ponto.id);
  if (idx >= 0) {
    sessao.pontos[idx] = ponto;
  } else {
    sessao.pontos.push(ponto);
  }
  sessao.atualizadoEm = Date.now();
  salvarNoDisco();
}

export function atualizarStatusEscalaSessao(
  tokenOuEventoId: string,
  escalaId: string,
  status: string,
): void {
  const sessao = sessoesPorToken.get(tokenOuEventoId) || sessoesPorEventoId.get(tokenOuEventoId);
  if (!sessao) return;

  const escala = sessao.escalas.find((e) => e.escalaId === escalaId);
  if (escala) {
    escala.status = status;
    sessao.atualizadoEm = Date.now();
    salvarNoDisco();
  }
}
