import crypto from "node:crypto";

export interface PayloadQrCodePonto {
  eventoId: string;
  empresaId: string;
  nome: string;
  local?: string | null;
  status?: string | null;
  data_inicio: string;
  data_fim?: string | null;
  qr_code_expira_em?: string | null;
  qr_code_token: string;
  exigeSelfie?: boolean;
  exigeGps?: boolean;
  pontoBasico?: boolean;
  exp: number; // timestamp ms
}

const SECRET =
  process.env["PONTO_SIGNING_SECRET"] || "swali_ponto_digital_safe_secret_key_2026_x89a1c";

/**
 * Cria um token assinado e autocontido para o QR Code do evento.
 * Pode ser lido pelo celular de qualquer colaborador mesmo sem sessão aberta no Supabase.
 */
export function criarTokenQrCodeAssinado(
  evento: {
    id: string;
    empresa_id: string;
    nome: string;
    local?: string | null;
    status?: string | null;
    data_inicio: string;
    data_fim?: string | null;
    qr_code_expira_em?: string | null;
    qr_code_token?: string | null;
  },
  opcoes?: {
    exigeSelfie?: boolean;
    exigeGps?: boolean;
    pontoBasico?: boolean;
    duracaoHoras?: number;
  },
): string {
  const agora = Date.now();
  const duracaoMs = (opcoes?.duracaoHoras ?? 24) * 60 * 60_000;
  let expTimestamp = agora + duracaoMs;

  if (evento.qr_code_expira_em) {
    const gravada = new Date(evento.qr_code_expira_em).getTime();
    if (Number.isFinite(gravada) && gravada > agora) {
      expTimestamp = Math.max(expTimestamp, gravada);
    }
  }

  const payload: PayloadQrCodePonto = {
    eventoId: evento.id,
    empresaId: evento.empresa_id,
    nome: evento.nome,
    local: evento.local ?? null,
    status: evento.status ?? null,
    data_inicio: evento.data_inicio,
    data_fim: evento.data_fim ?? null,
    qr_code_expira_em: new Date(expTimestamp).toISOString(),
    qr_code_token: evento.qr_code_token || evento.id.replaceAll("-", ""),
    exigeSelfie: Boolean(opcoes?.exigeSelfie),
    exigeGps: Boolean(opcoes?.exigeGps),
    pontoBasico: Boolean(opcoes?.pontoBasico),
    exp: expTimestamp,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");

  return `qr.${payloadB64}.${signature}`;
}

/**
 * Decodifica e valida a assinatura criptográfica e a expiração do token de QR Code.
 */
export function decodificarTokenQrCode(token: string): PayloadQrCodePonto | null {
  if (!token || !token.startsWith("qr.")) {
    return null;
  }

  const partes = token.split(".");
  if (partes.length !== 3) {
    return null;
  }

  const [, payloadB64, signature] = partes;
  if (!payloadB64 || !signature) {
    return null;
  }

  // Verifica assinatura HMAC
  const esperada = crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");

  if (signature.length !== esperada.length) {
    return null;
  }

  const bufRecebida = Buffer.from(signature, "utf8");
  const bufEsperada = Buffer.from(esperada, "utf8");
  if (!crypto.timingSafeEqual(bufRecebida, bufEsperada)) {
    return null;
  }

  try {
    const raw = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(raw) as PayloadQrCodePonto;

    // Valida expiração
    if (Date.now() > payload.exp) {
      // Tolerância de 12 horas para eventos recentes
      if (Date.now() - payload.exp < 12 * 60 * 60_000) {
        return payload;
      }
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
