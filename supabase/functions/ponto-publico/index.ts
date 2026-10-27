import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import type { Database } from "../../../src/integrations/supabase/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sequence = ["entrada", "inicio_intervalo", "fim_intervalo", "saida"] as const;
type TipoPonto = (typeof sequence)[number];
type AdminClient = ReturnType<typeof createClient<Database>>;

class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function failIfError(error: { message: string } | null, context: string): void {
  if (!error) return;
  console.error(`[ponto-publico] ${context}:`, error);
  throw new RequestError(`${context}: ${error.message}`, 500);
}

function text(value: unknown, name: string, min = 1, max = 256): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new RequestError(`${name} inválido.`);
  }
  return value;
}

function cpfValue(value: unknown): string {
  const cpf = text(value, "CPF", 11, 11);
  if (!/^\d{11}$/.test(cpf)) throw new RequestError("CPF deve ter 11 dígitos.");
  return cpf;
}

function tokenValue(value: unknown): string {
  const token = text(value, "Token", 8, 128);
  if (!/^[a-zA-Z0-9-]+$/.test(token)) throw new RequestError("Token do QR Code inválido.");
  return token;
}

function validarValidadeQr(evento: {
  data_fim: string | null;
  qr_code_expira_em: string | null;
}): string {
  const agora = Date.now();
  if (evento.qr_code_expira_em) {
    const expira = new Date(evento.qr_code_expira_em).getTime();
    if (!Number.isFinite(expira) || agora > expira) {
      throw new RequestError(
        "Este QR Code está expirado. Peça ao supervisor para gerar um novo código.",
      );
    }
    return evento.qr_code_expira_em;
  }

  if (evento.data_fim) {
    const expira = new Date(evento.data_fim).getTime() + 12 * 60 * 60_000;
    if (!Number.isFinite(expira) || agora > expira) {
      throw new RequestError(
        "Este QR Code está expirado. Peça ao supervisor para gerar um novo código.",
      );
    }
    return new Date(expira).toISOString();
  }

  return new Date(agora + 12 * 60 * 60_000).toISOString();
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function registrarTentativa(
  supabase: AdminClient,
  token: string,
  cpf: string,
  ip: string,
  action: string,
  sucesso: boolean,
): Promise<void> {
  const { error } = await supabase.from("tentativas_ponto_publico").insert({
    token_hash: await hash(token),
    cpf_hash: await hash(cpf),
    ip_hash: await hash(ip),
    acao: action,
    sucesso,
  });
  failIfError(error, "Não foi possível registrar auditoria da tentativa");
}

async function comLimiteDeTentativas<T>(
  supabase: AdminClient,
  request: Request,
  token: string,
  cpf: string,
  action: string,
  operation: () => Promise<T>,
): Promise<T> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "indisponivel";
  const desde = new Date(Date.now() - 10 * 60_000).toISOString();
  const tokenHash = await hash(token);
  const ipHash = await hash(ip);
  const { count, error } = await supabase
    .from("tentativas_ponto_publico")
    .select("id", { count: "exact", head: true })
    .eq("token_hash", tokenHash)
    .eq("ip_hash", ipHash)
    .gte("criado_em", desde);
  failIfError(error, "Não foi possível verificar o limite de tentativas");
  if ((count ?? 0) >= 20) {
    throw new RequestError("Muitas tentativas. Aguarde 10 minutos e tente novamente.", 429);
  }

  try {
    const result = await operation();
    await registrarTentativa(supabase, token, cpf, ip, action, true);
    return result;
  } catch (error) {
    try {
      await registrarTentativa(supabase, token, cpf, ip, action, false);
    } catch (auditError) {
      console.error("[ponto-publico] Falha ao registrar tentativa malsucedida:", auditError);
    }
    throw error;
  }
}

async function localizarEscala(supabase: AdminClient, token: string, cpf: string) {
  const { data: evento, error: erroEvento } = await supabase
    .from("eventos")
    .select("id, empresa_id, data_fim, qr_code_expira_em")
    .eq("qr_code_token", token)
    .maybeSingle();
  failIfError(erroEvento, "Não foi possível localizar o evento do QR Code");
  if (!evento) throw new RequestError("QR Code inválido.");
  validarValidadeQr(evento);

  const { data: freelancer, error: erroFreelancer } = await supabase
    .from("freelancers")
    .select("id, nome")
    .eq("empresa_id", evento.empresa_id)
    .eq("cpf", cpf)
    .maybeSingle();
  failIfError(erroFreelancer, "Não foi possível localizar o colaborador");
  if (!freelancer) throw new RequestError("CPF não encontrado nesta agência.");

  const { data: equipes, error: erroEquipes } = await supabase
    .from("equipes")
    .select("id")
    .eq("evento_id", evento.id);
  failIfError(erroEquipes, "Não foi possível localizar a equipe do evento");
  const equipeIds = (equipes ?? []).map((equipe) => equipe.id);
  if (equipeIds.length === 0) throw new RequestError("Você não está escalado neste evento.");

  const { data: escala, error: erroEscala } = await supabase
    .from("escalas")
    .select("id, status")
    .eq("freelancer_id", freelancer.id)
    .in("equipe_id", equipeIds)
    .neq("status", "substituido")
    .maybeSingle();
  failIfError(erroEscala, "Não foi possível localizar a escala");
  if (!escala) throw new RequestError("Você não está escalado neste evento.");
  if (escala.status === "recusado") {
    throw new RequestError("Sua participação neste evento foi recusada.");
  }

  return { evento, freelancer, escala };
}

async function obterContexto(supabase: AdminClient, token: string) {
  const { data: evento, error: erroEvento } = await supabase
    .from("eventos")
    .select("id, nome, local, status, empresa_id, data_inicio, data_fim, qr_code_expira_em")
    .eq("qr_code_token", token)
    .maybeSingle();
  failIfError(erroEvento, "Não foi possível consultar o QR Code");
  if (!evento) throw new RequestError("QR Code inválido ou expirado.");

  const expiraEm = validarValidadeQr(evento);
  const { data: config, error: erroConfig } = await supabase
    .from("configuracoes")
    .select("checkin_exige_selfie, checkin_exige_gps")
    .eq("empresa_id", evento.empresa_id)
    .maybeSingle();
  failIfError(erroConfig, "Não foi possível carregar as configurações de ponto");

  const { data: plano, error: erroPlano } = await supabase.rpc("plano_da_empresa", {
    _empresa_id: evento.empresa_id,
  });
  failIfError(erroPlano, "Não foi possível consultar o plano da agência");

  return {
    pontoBasico: plano?.codigo === "free",
    evento: {
      id: evento.id,
      nome: evento.nome,
      local: evento.local,
      status: evento.status,
      data_inicio: evento.data_inicio,
      data_fim: evento.data_fim,
      qr_code_expira_em: expiraEm,
    },
    exigeSelfie: config?.checkin_exige_selfie ?? false,
    exigeGps: config?.checkin_exige_gps ?? false,
  };
}

async function identificar(supabase: AdminClient, token: string, cpf: string) {
  const { escala, freelancer } = await localizarEscala(supabase, token, cpf);
  const { data: pontos, error } = await supabase
    .from("pontos")
    .select("id, tipo, registrado_em, status, fora_horario")
    .eq("escala_id", escala.id)
    .order("registrado_em");
  failIfError(error, "Não foi possível carregar as marcações");
  return {
    escalaId: escala.id,
    statusEscala: escala.status,
    nome: freelancer.nome,
    pontos: pontos ?? [],
  };
}

async function confirmar(supabase: AdminClient, token: string, cpf: string) {
  const { escala } = await localizarEscala(supabase, token, cpf);
  if (escala.status !== "convidado") return { ok: true as const };

  const { data, error } = await supabase
    .from("escalas")
    .update({ status: "confirmado", confirmado_em: new Date().toISOString() })
    .eq("id", escala.id)
    .eq("status", "convidado")
    .select("id")
    .maybeSingle();
  failIfError(error, "Não foi possível confirmar a presença");
  if (!data) throw new RequestError("A escala mudou. Atualize a página e tente novamente.", 409);
  return { ok: true as const };
}

async function registrar(supabase: AdminClient, input: Record<string, unknown>) {
  const token = tokenValue(input.token);
  const cpf = cpfValue(input.cpf);
  const escalaId = text(input.escalaId, "Escala", 36, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(escalaId)
  ) {
    throw new RequestError("Escala inválida.");
  }
  const tipo = text(input.tipo, "Tipo de ponto", 1, 32);
  if (!sequence.includes(tipo as TipoPonto)) throw new RequestError("Tipo de ponto inválido.");
  const tipoValido = tipo as TipoPonto;
  const fotoBase64 =
    typeof input.fotoBase64 === "string" && input.fotoBase64.length > 0
      ? text(input.fotoBase64, "Selfie", 1, 4_000_000)
      : null;
  const lat = input.lat === null || input.lat === undefined ? null : Number(input.lat);
  const lng = input.lng === null || input.lng === undefined ? null : Number(input.lng);
  if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) {
    throw new RequestError("Coordenadas GPS inválidas.");
  }
  if ((lat === null) !== (lng === null)) throw new RequestError("Coordenadas GPS incompletas.");

  const { evento, escala } = await localizarEscala(supabase, token, cpf);
  if (escala.id !== escalaId) throw new RequestError("Escala inválida.");

  const { data: config, error: erroConfig } = await supabase
    .from("configuracoes")
    .select("checkin_exige_selfie, checkin_exige_gps, selfie_retencao_dias")
    .eq("empresa_id", evento.empresa_id)
    .maybeSingle();
  failIfError(erroConfig, "Não foi possível carregar as configurações de ponto");
  if (config?.checkin_exige_selfie && !fotoBase64) {
    throw new RequestError("Esta agência exige selfie no registro de ponto.");
  }
  if (config?.checkin_exige_selfie && input.consentiuSelfie !== true) {
    throw new RequestError("Confirme o uso da selfie para revisão do registro.");
  }
  if (config?.checkin_exige_gps && (lat === null || lng === null)) {
    throw new RequestError("Esta agência exige a localização no registro de ponto.");
  }

  let fotoUrl: string | null = null;
  if (fotoBase64) {
    const partesFoto = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(fotoBase64);
    if (!partesFoto) throw new RequestError("Formato de selfie inválido.");
    const formato = partesFoto[1];
    const bytes = Uint8Array.from(atob(partesFoto[2]!), (caractere) => caractere.charCodeAt(0));
    const caminho = `${evento.empresa_id}/${escala.id}/${crypto.randomUUID()}.${formato === "jpeg" ? "jpg" : formato}`;
    const { error } = await supabase.storage
      .from("selfies-ponto")
      .upload(caminho, bytes, { contentType: `image/${formato}`, upsert: false });
    failIfError(error, "Não foi possível armazenar a selfie");
    fotoUrl = caminho;
  }

  const { data: existentes, error: erroExistentes } = await supabase
    .from("pontos")
    .select("tipo")
    .eq("escala_id", escala.id)
    .neq("status", "recusado")
    .order("registrado_em");
  failIfError(erroExistentes, "Não foi possível validar a ordem das marcações");

  const { data: plano, error: erroPlano } = await supabase.rpc("plano_da_empresa", {
    _empresa_id: evento.empresa_id,
  });
  failIfError(erroPlano, "Não foi possível verificar o plano da agência");
  const sequencia = plano?.codigo === "free" ? ["entrada", "saida"] : sequence;
  const esperado = sequencia[(existentes ?? []).length];
  if (!esperado) throw new RequestError("Todos os registros desta escala já foram concluídos.");
  if (tipo !== esperado) {
    throw new RequestError(`O próximo registro deve ser ${esperado.replaceAll("_", " ")}.`);
  }

  const agora = new Date();
  const foraHorario = Boolean(evento.data_fim && agora > new Date(evento.data_fim));
  const retencaoDias = Math.min(
    config?.selfie_retencao_dias ?? 90,
    plano?.retencao_evidencias_dias ?? 365,
  );
  const { data: ponto, error: erroPonto } = await supabase
    .from("pontos")
    .insert({
      escala_id: escala.id,
      tipo: tipoValido,
      metodo: fotoBase64 ? "selfie" : "qrcode",
      registrado_em: agora.toISOString(),
      foto_url: fotoUrl,
      gps_lat: lat,
      gps_lng: lng,
      status: "pendente",
      fora_horario: foraHorario,
      selfie_consentimento_aceito_em: fotoBase64 ? agora.toISOString() : null,
      selfie_expira_em: fotoBase64
        ? new Date(agora.getTime() + retencaoDias * 24 * 60 * 60_000).toISOString()
        : null,
    })
    .select("id")
    .single();
  failIfError(erroPonto, "Não foi possível registrar a marcação");
  if (!ponto) throw new RequestError("Não foi possível confirmar a gravação da marcação.", 500);

  const { error: erroAuditoria } = await supabase.from("auditoria_ponto_publico").insert({
    empresa_id: evento.empresa_id,
    escala_id: escala.id,
    ponto_id: ponto.id,
    acao: "ponto_registrado",
    resultado: "sucesso",
    detalhes: {
      tipo: tipoValido,
      fora_horario: foraHorario,
      com_selfie: Boolean(fotoBase64),
    },
  });
  failIfError(erroAuditoria, "A marcação foi registrada, mas a auditoria falhou");

  return { ok: true as const, foraHorario };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Método não permitido." }, { status: 405, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[ponto-publico] Supabase Edge Function sem credenciais de serviço.");
      throw new RequestError("Configuração interna do serviço de ponto incompleta.", 500);
    }
    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new RequestError("Requisição inválida.");
    }
    const body = input as Record<string, unknown>;
    const action = text(body.action, "Ação", 1, 32);
    const token = tokenValue(body.token);

    let result: unknown;
    if (action === "contexto") {
      result = await obterContexto(supabase, token);
    } else if (action === "identificar" || action === "confirmar" || action === "registrar") {
      const cpf = cpfValue(body.cpf);
      if (action === "identificar") {
        result = await comLimiteDeTentativas(supabase, request, token, cpf, action, () =>
          identificar(supabase, token, cpf),
        );
      } else if (action === "confirmar") {
        result = await comLimiteDeTentativas(supabase, request, token, cpf, action, () =>
          confirmar(supabase, token, cpf),
        );
      } else {
        result = await comLimiteDeTentativas(supabase, request, token, cpf, action, () =>
          registrar(supabase, body),
        );
      }
    } else {
      throw new RequestError("Ação não suportada.");
    }

    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    if (!(error instanceof RequestError)) {
      console.error("[ponto-publico] Erro inesperado:", error);
    }
    const message = error instanceof Error ? error.message : "Erro interno ao processar o ponto.";
    return Response.json({ error: message }, { status, headers: corsHeaders });
  }
});
