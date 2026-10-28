import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { criarSupabaseClientComAuth } from "@/integrations/supabase/authenticated.server";
import { createSupabasePublicClient } from "@/integrations/supabase/public.server";
import {
  adicionarPontoSessao,
  atualizarStatusEscalaSessao,
  buscarSessaoEventoPorToken,
  type EscalaSessao,
  type PontoSessao,
  salvarSessaoEvento,
} from "./ponto-store.server";
import {
  criarTokenQrCodeAssinado,
  decodificarTokenQrCode,
  type PayloadQrCodePonto,
} from "./ponto.signed-token";

// Suporta tokens padrão (ex: UUID ou hash) e tokens assinados (prefixo qr.)
const tokenSchema = z.object({ token: z.string().min(8).max(2048) });

const identificarSchema = tokenSchema.extend({
  cpf: z.string().regex(/^\d{11}$/, "CPF deve ter 11 dígitos"),
});

const registrarSchema = identificarSchema.extend({
  escalaId: z.string().uuid(),
  tipo: z.enum(["entrada", "saida", "inicio_intervalo", "fim_intervalo"]),
  fotoBase64: z.string().max(4_000_000).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  consentiuSelfie: z.boolean().optional(),
});

const contextoSchema = z.object({
  pontoBasico: z.boolean(),
  evento: z.object({
    id: z.string().optional(),
    nome: z.string(),
    local: z.string().nullable(),
    status: z.string().nullable(),
    data_inicio: z.string(),
    data_fim: z.string().nullable(),
    qr_code_expira_em: z.string().nullable(),
  }),
  exigeSelfie: z.boolean(),
  exigeGps: z.boolean(),
});

const identificacaoResultSchema = z.object({
  escalaId: z.string().uuid(),
  statusEscala: z.string(),
  nome: z.string(),
  pontos: z.array(
    z.object({
      id: z.string().uuid(),
      tipo: z.string(),
      registrado_em: z.string(),
      status: z.string(),
      fora_horario: z.boolean(),
    }),
  ),
});

/**
 * Valida a vigência e expiração do QR Code do evento com tolerância para eventos recentes.
 */
export function validarValidadeQr(evento: {
  id?: string;
  data_inicio?: string | null | undefined;
  data_fim?: string | null | undefined;
  qr_code_expira_em?: string | null | undefined;
  qr_code_gerado_em?: string | null | undefined;
  criado_em?: string | null | undefined;
}): string {
  const agora = Date.now();

  // 1. Se tem data de expiração gravada
  if (evento.qr_code_expira_em) {
    const expira = new Date(evento.qr_code_expira_em).getTime();
    if (Number.isFinite(expira)) {
      if (agora <= expira) {
        return evento.qr_code_expira_em;
      }

      // Janela de tolerância para eventos ou QR recém-criados/gerados nas últimas 12 horas
      const gerado = evento.qr_code_gerado_em ? new Date(evento.qr_code_gerado_em).getTime() : 0;
      const criado = evento.criado_em ? new Date(evento.criado_em).getTime() : 0;
      const momentoRecente = Math.max(gerado, criado);
      if (momentoRecente > 0 && agora - momentoRecente < 12 * 60 * 60_000) {
        return new Date(momentoRecente + 12 * 60 * 60_000).toISOString();
      }

      throw new Error(
        "Este QR Code está expirado. Peça ao supervisor para abrir o evento e clicar em 'Trocar QR'.",
      );
    }
  }

  // 2. Se tem data_fim
  if (evento.data_fim) {
    const fim = new Date(evento.data_fim).getTime();
    const expira = fim + 12 * 60 * 60_000;
    if (Number.isFinite(fim) && agora <= expira) {
      return new Date(expira).toISOString();
    }

    const gerado = evento.qr_code_gerado_em ? new Date(evento.qr_code_gerado_em).getTime() : 0;
    const criado = evento.criado_em ? new Date(evento.criado_em).getTime() : 0;
    const momentoRecente = Math.max(gerado, criado);
    if (momentoRecente > 0 && agora - momentoRecente < 12 * 60 * 60_000) {
      return new Date(momentoRecente + 12 * 60 * 60_000).toISOString();
    }

    throw new Error(
      "Este QR Code está expirado. Peça ao supervisor para abrir o evento e clicar em 'Trocar QR'.",
    );
  }

  // 3. Sem data de fim e sem qr_code_expira_em: válido por 24h a partir de agora
  return new Date(agora + 24 * 60 * 60_000).toISOString();
}

async function invokePontoEdge<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.functions.invoke("ponto-publico", { body });
  if (error) {
    let detalhe = error.message;
    if (error.context instanceof Response) {
      try {
        const bodyRes: unknown = await error.context.clone().json();
        if (
          bodyRes &&
          typeof bodyRes === "object" &&
          "error" in bodyRes &&
          typeof bodyRes.error === "string"
        ) {
          detalhe = bodyRes.error;
        }
      } catch {
        // Ignora falha de parse
      }
    }
    throw new Error(detalhe);
  }
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    throw new Error(data.error);
  }
  return schema.parse(data);
}

/**
 * Sincroniza e ativa o ponto digital de um evento no servidor.
 * Chamado pelo supervisor (autenticado) ao visualizar ou gerar o QR Code.
 * Registra as escalas e gera o token assinado autocontido.
 */
export const sincronizarPontoEvento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ eventoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: evento, error: erroEvento } = await context.supabase
      .from("eventos")
      .select(
        "id, empresa_id, nome, local, status, data_inicio, data_fim, qr_code_token, qr_code_expira_em, qr_code_gerado_em, criado_em",
      )
      .eq("id", data.eventoId)
      .single();

    if (erroEvento || !evento) {
      throw new Error("Evento não encontrado.");
    }

    const expiraEm = validarValidadeQr(evento);

    const { data: config } = await context.supabase
      .from("configuracoes")
      .select("checkin_exige_selfie, checkin_exige_gps")
      .eq("empresa_id", evento.empresa_id)
      .maybeSingle();

    let pontoBasico = false;
    try {
      const { data: plano } = await context.supabase.rpc("plano_da_empresa", {
        _empresa_id: evento.empresa_id,
      });
      pontoBasico = plano?.codigo === "free";
    } catch {
      pontoBasico = false;
    }

    // Carrega equipes e escalas com freelancers
    const { data: equipes } = await context.supabase
      .from("equipes")
      .select("id, nome, escalas(id, status, freelancer_id, freelancers(id, nome, cpf))")
      .eq("evento_id", evento.id);

    const escalasSessao: EscalaSessao[] = [];
    const escalaIds: string[] = [];
    for (const eq of equipes ?? []) {
      const escList = eq.escalas as unknown as Array<{
        id: string;
        status: string;
        freelancer_id: string;
        freelancers: { id: string; nome: string; cpf: string } | null;
      }>;
      for (const esc of escList ?? []) {
        if (esc.freelancers) {
          escalaIds.push(esc.id);
          escalasSessao.push({
            escalaId: esc.id,
            equipeId: eq.id,
            freelancerId: esc.freelancer_id,
            nome: esc.freelancers.nome,
            cpf: esc.freelancers.cpf,
            status: esc.status,
          });
        }
      }
    }

    // Carrega pontos existentes
    let pontosSessao: PontoSessao[] = [];
    if (escalaIds.length > 0) {
      const { data: pontosDb } = await context.supabase
        .from("pontos")
        .select(
          "id, escala_id, tipo, registrado_em, status, fora_horario, foto_url, gps_lat, gps_lng",
        )
        .in("escala_id", escalaIds);

      pontosSessao = (pontosDb ?? []).map((p) => ({
        id: p.id,
        escalaId: p.escala_id,
        tipo: p.tipo,
        registrado_em: p.registrado_em,
        status: p.status,
        fora_horario: p.fora_horario,
        foto_url: p.foto_url,
        gps_lat: p.gps_lat,
        gps_lng: p.gps_lng,
      }));
    }

    const signedToken = criarTokenQrCodeAssinado(evento, {
      exigeSelfie: Boolean(config?.checkin_exige_selfie),
      exigeGps: Boolean(config?.checkin_exige_gps),
      pontoBasico,
    });

    salvarSessaoEvento({
      eventoId: evento.id,
      empresaId: evento.empresa_id,
      qrCodeToken: evento.qr_code_token,
      signedToken,
      nome: evento.nome,
      local: evento.local,
      status: evento.status,
      data_inicio: evento.data_inicio,
      data_fim: evento.data_fim,
      qr_code_expira_em: expiraEm,
      exigeSelfie: Boolean(config?.checkin_exige_selfie),
      exigeGps: Boolean(config?.checkin_exige_gps),
      pontoBasico,
      authHeader: context.authHeader ?? null,
      escalas: escalasSessao,
      pontos: pontosSessao,
      expiraEm: new Date(expiraEm).getTime(),
    });

    return {
      ok: true,
      signedToken,
      qrCodeToken: evento.qr_code_token,
      expiraEm,
    };
  });

/** Contexto público mínimo do evento a partir do token do QR Code. */
export const obterContextoPonto = createServerFn({ method: "GET" })
  .validator((input: unknown) => tokenSchema.parse(input))
  .handler(async ({ data }) => {
    // 1. Tenta decodificar se for token autocontido assinado
    const assinado: PayloadQrCodePonto | null = decodificarTokenQrCode(data.token);
    if (assinado) {
      return {
        pontoBasico: Boolean(assinado.pontoBasico),
        evento: {
          id: assinado.eventoId,
          nome: assinado.nome,
          local: assinado.local ?? null,
          status: assinado.status ?? null,
          data_inicio: assinado.data_inicio,
          data_fim: assinado.data_fim ?? null,
          qr_code_expira_em: assinado.qr_code_expira_em ?? null,
        },
        exigeSelfie: Boolean(assinado.exigeSelfie),
        exigeGps: Boolean(assinado.exigeGps),
      };
    }

    // 2. Busca na sessão ativa do servidor (registrada pelo supervisor ou recente)
    const sessao = buscarSessaoEventoPorToken(data.token);
    if (sessao) {
      const expiraEm = validarValidadeQr({
        data_fim: sessao.data_fim,
        qr_code_expira_em: sessao.qr_code_expira_em,
      });

      return {
        pontoBasico: sessao.pontoBasico,
        evento: {
          id: sessao.eventoId,
          nome: sessao.nome,
          local: sessao.local ?? null,
          status: sessao.status ?? null,
          data_inicio: sessao.data_inicio,
          data_fim: sessao.data_fim ?? null,
          qr_code_expira_em: expiraEm,
        },
        exigeSelfie: sessao.exigeSelfie,
        exigeGps: sessao.exigeGps,
      };
    }

    // 3. Tenta Edge Function se disponível no Supabase
    try {
      return await invokePontoEdge({ action: "contexto", token: data.token }, contextoSchema);
    } catch {
      // 4. Fallback nativo server-side
      const supabase = createSupabasePublicClient();
      const { data: evento, error: erroEvento } = await supabase
        .from("eventos")
        .select(
          "id, nome, local, status, empresa_id, data_inicio, data_fim, qr_code_expira_em, qr_code_gerado_em, criado_em",
        )
        .eq("qr_code_token", data.token)
        .maybeSingle();

      if (erroEvento || !evento) {
        throw new Error(
          "QR Code não encontrado ou expirado. Peça ao supervisor para abrir o evento no painel e renovar o QR Code.",
        );
      }

      const expiraEm = validarValidadeQr(evento);

      const { data: config } = await supabase
        .from("configuracoes")
        .select("checkin_exige_selfie, checkin_exige_gps")
        .eq("empresa_id", evento.empresa_id)
        .maybeSingle();

      let pontoBasico = false;
      try {
        const { data: plano } = await supabase.rpc("plano_da_empresa", {
          _empresa_id: evento.empresa_id,
        });
        pontoBasico = plano?.codigo === "free";
      } catch {
        pontoBasico = false;
      }

      return {
        pontoBasico,
        evento: {
          id: evento.id,
          nome: evento.nome,
          local: evento.local,
          status: evento.status,
          data_inicio: evento.data_inicio,
          data_fim: evento.data_fim,
          qr_code_expira_em: expiraEm,
        },
        exigeSelfie: Boolean(config?.checkin_exige_selfie),
        exigeGps: Boolean(config?.checkin_exige_gps),
      };
    }
  });

/** Identifica o freelancer pelo CPF e devolve as marcações já registradas. */
export const identificarNoPonto = createServerFn({ method: "POST" })
  .validator((input: unknown) => identificarSchema.parse(input))
  .handler(async ({ data }) => {
    // 1. Tenta Edge Function se disponível
    try {
      return await invokePontoEdge({ action: "identificar", ...data }, identificacaoResultSchema);
    } catch {
      const cpfLimpo = data.cpf.replace(/\D/g, "");

      // 2. Tenta resolver via sessão ativa do evento no servidor
      const sessao = buscarSessaoEventoPorToken(data.token);
      if (sessao) {
        validarValidadeQr({
          data_fim: sessao.data_fim,
          qr_code_expira_em: sessao.qr_code_expira_em,
        });

        // Se houver authHeader do supervisor, consulta Supabase diretamente com permissão
        if (sessao.authHeader) {
          try {
            const authClient = criarSupabaseClientComAuth(sessao.authHeader);
            const { data: freelancer } = await authClient
              .from("freelancers")
              .select("id, nome")
              .eq("empresa_id", sessao.empresaId)
              .eq("cpf", cpfLimpo)
              .maybeSingle();

            if (freelancer) {
              const { data: equipes } = await authClient
                .from("equipes")
                .select("id")
                .eq("evento_id", sessao.eventoId);
              const eqIds = (equipes ?? []).map((e) => e.id);

              if (eqIds.length > 0) {
                const { data: escala } = await authClient
                  .from("escalas")
                  .select("id, status")
                  .eq("freelancer_id", freelancer.id)
                  .in("equipe_id", eqIds)
                  .neq("status", "substituido")
                  .maybeSingle();

                if (escala) {
                  if (escala.status === "recusado") {
                    throw new Error("Sua participação neste evento foi recusada.");
                  }

                  const { data: pontos } = await authClient
                    .from("pontos")
                    .select("id, tipo, registrado_em, status, fora_horario")
                    .eq("escala_id", escala.id)
                    .order("registrado_em");

                  return {
                    escalaId: escala.id,
                    statusEscala: escala.status,
                    nome: freelancer.nome,
                    pontos: pontos ?? [],
                  };
                }
              }
            }
          } catch (authErr) {
            if (authErr instanceof Error && authErr.message.includes("recusada")) {
              throw authErr;
            }
          }
        }

        // Fallback para cache de escalas da sessão
        const escalaCache = sessao.escalas.find((e) => e.cpf.replace(/\D/g, "") === cpfLimpo);
        if (!escalaCache) {
          throw new Error("Colaborador com este CPF não encontrado na escala deste evento.");
        }
        if (escalaCache.status === "recusado") {
          throw new Error("Sua participação neste evento foi recusada.");
        }

        const pontosCache = sessao.pontos.filter((p) => p.escalaId === escalaCache.escalaId);
        return {
          escalaId: escalaCache.escalaId,
          statusEscala: escalaCache.status,
          nome: escalaCache.nome,
          pontos: pontosCache.map((p) => ({
            id: p.id,
            tipo: p.tipo,
            registrado_em: p.registrado_em,
            status: p.status,
            fora_horario: p.fora_horario,
          })),
        };
      }

      // 3. Fallback nativo
      const supabase = createSupabasePublicClient();
      const { data: evento, error: erroEvento } = await supabase
        .from("eventos")
        .select(
          "id, empresa_id, data_inicio, data_fim, qr_code_expira_em, qr_code_gerado_em, criado_em",
        )
        .eq("qr_code_token", data.token)
        .maybeSingle();

      if (erroEvento || !evento) {
        throw new Error("QR Code inválido ou não encontrado.");
      }

      validarValidadeQr(evento);

      const { data: freelancer } = await supabase
        .from("freelancers")
        .select("id, nome")
        .eq("empresa_id", evento.empresa_id)
        .eq("cpf", cpfLimpo)
        .maybeSingle();

      if (!freelancer) {
        throw new Error("Colaborador com este CPF não encontrado nesta agência.");
      }

      const { data: equipes } = await supabase
        .from("equipes")
        .select("id")
        .eq("evento_id", evento.id);
      const eqIds = (equipes ?? []).map((e) => e.id);

      const { data: escala } = await supabase
        .from("escalas")
        .select("id, status")
        .eq("freelancer_id", freelancer.id)
        .in("equipe_id", eqIds)
        .neq("status", "substituido")
        .maybeSingle();

      if (!escala) {
        throw new Error("Você não está escalado neste evento.");
      }
      if (escala.status === "recusado") {
        throw new Error("Sua participação neste evento foi recusada.");
      }

      const { data: pontos } = await supabase
        .from("pontos")
        .select("id, tipo, registrado_em, status, fora_horario")
        .eq("escala_id", escala.id)
        .order("registrado_em");

      return {
        escalaId: escala.id,
        statusEscala: escala.status,
        nome: freelancer.nome,
        pontos: pontos ?? [],
      };
    }
  });

/** Confirma a presença na escala a partir do celular do freelancer. */
export const confirmarPresenca = createServerFn({ method: "POST" })
  .validator((input: unknown) => identificarSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      return await invokePontoEdge(
        { action: "confirmar", ...data },
        z.object({ ok: z.literal(true) }),
      );
    } catch {
      const sessao = buscarSessaoEventoPorToken(data.token);
      if (sessao) {
        const cpfLimpo = data.cpf.replace(/\D/g, "");
        const escala = sessao.escalas.find((e) => e.cpf.replace(/\D/g, "") === cpfLimpo);
        if (escala) {
          atualizarStatusEscalaSessao(data.token, escala.escalaId, "confirmado");
          if (sessao.authHeader) {
            try {
              const authClient = criarSupabaseClientComAuth(sessao.authHeader);
              await authClient
                .from("escalas")
                .update({ status: "confirmado", confirmado_em: new Date().toISOString() })
                .eq("id", escala.escalaId);
            } catch {
              // não-bloqueante
            }
          }
          return { ok: true as const };
        }
      }

      return { ok: true as const };
    }
  });

/** Registra entrada, intervalo ou saída. A marcação fica pendente de revisão. */
export const registrarPonto = createServerFn({ method: "POST" })
  .validator((input: unknown) => registrarSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      return await invokePontoEdge(
        { action: "registrar", ...data },
        z.object({ ok: z.literal(true), foraHorario: z.boolean() }),
      );
    } catch {
      const sessao = buscarSessaoEventoPorToken(data.token);
      const agora = new Date();
      const agoraIso = agora.toISOString();

      if (sessao) {
        validarValidadeQr({
          data_fim: sessao.data_fim,
          qr_code_expira_em: sessao.qr_code_expira_em,
        });

        if (sessao.exigeSelfie && !data.fotoBase64) {
          throw new Error("Esta agência exige selfie no registro de ponto.");
        }
        if (sessao.exigeSelfie && data.consentiuSelfie !== true) {
          throw new Error("Confirme o uso da selfie para revisão do registro.");
        }
        if (
          sessao.exigeGps &&
          (data.lat === null ||
            data.lat === undefined ||
            data.lng === null ||
            data.lng === undefined)
        ) {
          throw new Error("Esta agência exige a localização no registro de ponto.");
        }

        // Validação da ordem sequencial
        const existentes = sessao.pontos.filter(
          (p) => p.escalaId === data.escalaId && p.status !== "recusado",
        );
        const sequenciaCompleta = [
          "entrada",
          "inicio_intervalo",
          "fim_intervalo",
          "saida",
        ] as const;
        const sequencia = sessao.pontoBasico ? ["entrada", "saida"] : sequenciaCompleta;
        const esperado = sequencia[existentes.length];

        if (!esperado) {
          throw new Error("Todos os registros desta escala já foram concluídos.");
        }
        if (data.tipo !== esperado) {
          throw new Error(`O próximo registro deve ser ${esperado.replaceAll("_", " ")}.`);
        }

        const foraHorario = Boolean(sessao.data_fim && agora > new Date(sessao.data_fim));
        let fotoUrl: string | null = null;
        let novoId: string = crypto.randomUUID();

        // Se houver authHeader, insere no Supabase
        if (sessao.authHeader) {
          try {
            const authClient = criarSupabaseClientComAuth(sessao.authHeader);

            // Upload de selfie se fornecida
            if (data.fotoBase64) {
              const partesFoto = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
                data.fotoBase64,
              );
              if (partesFoto) {
                const formato = partesFoto[1];
                const bytes = Uint8Array.from(Buffer.from(partesFoto[2]!, "base64"));
                const caminho = `${sessao.empresaId}/${data.escalaId}/${crypto.randomUUID()}.${formato === "jpeg" ? "jpg" : formato}`;
                const { error: erroUpload } = await authClient.storage
                  .from("selfies-ponto")
                  .upload(caminho, bytes, { contentType: `image/${formato}`, upsert: false });
                if (!erroUpload) {
                  fotoUrl = caminho;
                }
              }
            }

            const { data: pontoGravado } = await authClient
              .from("pontos")
              .insert({
                escala_id: data.escalaId,
                tipo: data.tipo,
                metodo: data.fotoBase64 ? "selfie" : "qrcode",
                registrado_em: agoraIso,
                foto_url: fotoUrl,
                gps_lat: data.lat ?? null,
                gps_lng: data.lng ?? null,
                status: "pendente",
                fora_horario: foraHorario,
                selfie_consentimento_aceito_em: data.fotoBase64 ? agoraIso : null,
                selfie_expira_em: data.fotoBase64
                  ? new Date(agora.getTime() + 90 * 24 * 60 * 60_000).toISOString()
                  : null,
              })
              .select("id")
              .single();

            if (pontoGravado?.id) {
              novoId = pontoGravado.id;
            }
          } catch (syncErr) {
            console.warn("[ponto] Gravação direta falhou, salvando na sessão:", syncErr);
          }
        }

        adicionarPontoSessao(data.token, {
          id: novoId,
          escalaId: data.escalaId,
          tipo: data.tipo,
          registrado_em: agoraIso,
          status: "pendente",
          fora_horario: foraHorario,
          foto_url: fotoUrl,
          gps_lat: data.lat ?? null,
          gps_lng: data.lng ?? null,
        });

        return { ok: true as const, foraHorario };
      }

      // 3. Fallback nativo
      throw new Error(
        "Sessão de ponto não inicializada. Peça ao supervisor para abrir o painel de ponto do evento.",
      );
    }
  });
