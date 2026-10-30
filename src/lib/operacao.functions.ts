import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCapability } from "@/lib/autorizacao.server";
import {
  atualizarAuthHeaderSessao,
  atualizarStatusPontoSessao,
  buscarSessaoPorEventoId,
  type PontoSessao,
  salvarSessaoEvento,
} from "@/lib/ponto-store.server";
import { criarTokenQrCodeAssinado } from "@/lib/ponto.signed-token";

const tipoPonto = z.enum(["entrada", "inicio_intervalo", "fim_intervalo", "saida"]);

async function contextoOperacao(
  supabase: Parameters<typeof requireCapability>[0],
  userId: string,
  escalaId: string,
) {
  const contexto = await requireCapability(supabase, userId, "operacao.supervisionar");
  const { data: empresaId, error } = await supabase.rpc("empresa_da_escala", {
    _escala_id: escalaId,
  });
  if (error || !empresaId || empresaId !== contexto.empresaId) {
    throw new Error("Escala não encontrada nesta agência.");
  }
  return { contexto, empresaId };
}

async function getAdminClientSafe() {
  try {
    const { hasAdminKey, supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!hasAdminKey()) {
      return null;
    }
    return supabaseAdmin;
  } catch {
    return null;
  }
}

async function registrarAuditoria(
  client: Parameters<typeof requireCapability>[0],
  payload: {
    empresa_id: string;
    ator_id: string;
    ator_contexto: "organizacao";
    acao: string;
    recurso_tipo: string;
    recurso_id: string;
    resultado: "sucesso" | "erro";
    detalhes: Record<string, unknown>;
  },
) {
  try {
    const res = await client.from("logs_auditoria").insert(payload);
    if (res?.error) {
      const admin = await getAdminClientSafe();
      if (admin) {
        await admin.from("logs_auditoria").insert(payload);
      }
    }
  } catch {
    try {
      const admin = await getAdminClientSafe();
      if (admin) {
        await admin.from("logs_auditoria").insert(payload);
      }
    } catch {
      // Falha de auditoria não deve bloquear a operação
    }
  }
}

async function mesclarPontosSessao(
  eventoId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  equipes: any[],
  supabase: Parameters<typeof requireCapability>[0],
) {
  const sessao = buscarSessaoPorEventoId(eventoId);
  if (!sessao || !sessao.pontos || sessao.pontos.length === 0) {
    return equipes;
  }

  const pontosParaSincronizarDb: Array<{
    escalaId: string;
    ponto: PontoSessao;
  }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultado = equipes.map((eq: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const escalasAtualizadas = (eq.escalas ?? []).map((es: any) => {
      const pontosExistentes = es.pontos ?? [];
      const pontosDaEscalaNaSessao = sessao.pontos.filter((p) => p.escalaId === es.id);

      const novosPontos = [...pontosExistentes];

      for (const pontoSessao of pontosDaEscalaNaSessao) {
        const jaExiste = novosPontos.some(
          (p: { id?: string; tipo?: string; registrado_em?: string }) =>
            p.id === pontoSessao.id ||
            (p.tipo === pontoSessao.tipo &&
              Boolean(p.registrado_em) &&
              Math.abs(
                new Date(p.registrado_em!).getTime() -
                  new Date(pontoSessao.registrado_em).getTime(),
              ) < 300_000),
        );

        if (!jaExiste) {
          novosPontos.push({
            id: pontoSessao.id,
            tipo: pontoSessao.tipo,
            metodo: pontoSessao.foto_url ? "selfie" : "qrcode",
            registrado_em: pontoSessao.registrado_em,
            status: pontoSessao.status ?? "pendente",
            foto_url: pontoSessao.foto_url ?? null,
            gps_lat: pontoSessao.gps_lat ?? null,
            gps_lng: pontoSessao.gps_lng ?? null,
            fora_horario: pontoSessao.fora_horario ?? false,
            motivo_recusa: null,
            selfie_expira_em: null,
          });

          pontosParaSincronizarDb.push({
            escalaId: es.id,
            ponto: pontoSessao,
          });
        }
      }

      return {
        ...es,
        pontos: novosPontos,
      };
    });

    return {
      ...eq,
      escalas: escalasAtualizadas,
    };
  });

  // Tenta persistir os pontos que estavam apenas na sessão para o banco
  if (pontosParaSincronizarDb.length > 0) {
    for (const item of pontosParaSincronizarDb) {
      try {
        await supabase.from("pontos").insert({
          id: item.ponto.id,
          escala_id: item.escalaId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tipo: item.ponto.tipo as any,
          metodo: item.ponto.foto_url ? "selfie" : "qrcode",
          registrado_em: item.ponto.registrado_em,
          foto_url: item.ponto.foto_url ?? null,
          gps_lat: item.ponto.gps_lat ?? null,
          gps_lng: item.ponto.gps_lng ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: (item.ponto.status as any) || "pendente",
          fora_horario: item.ponto.fora_horario ?? false,
        });
      } catch {
        // Silencioso se der erro de chave ou já existir
      }
    }
  }

  return resultado;
}

export const carregarOperacaoEvento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ eventoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireCapability(context.supabase, context.userId, "operacao.supervisionar");

    if (context.authHeader) {
      atualizarAuthHeaderSessao(data.eventoId, context.authHeader);
    }

    const { data: equipesDb, error } = await context.supabase
      .from("equipes")
      .select(
        "id, nome, escalas(id, status, freelancers(nome, funcao), pontos(id, tipo, metodo, registrado_em, status, foto_url, gps_lat, gps_lng, fora_horario, motivo_recusa, selfie_expira_em), ocorrencias(id, descricao, criado_em))",
      )
      .eq("evento_id", data.eventoId)
      .order("criado_em");

    if (error) {
      const { data: fallbackData, error: fallbackError } = await context.supabase
        .from("equipes")
        .select(
          "id, nome, escalas(id, status, freelancers(nome, funcao), pontos(id, tipo, metodo, registrado_em, status, foto_url, gps_lat, gps_lng), ocorrencias(id, descricao, criado_em))",
        )
        .eq("evento_id", data.eventoId)
        .order("criado_em");

      if (fallbackError) throw fallbackError;
      return mesclarPontosSessao(data.eventoId, fallbackData ?? [], context.supabase);
    }

    return mesclarPontosSessao(data.eventoId, equipesDb ?? [], context.supabase);
  });

export const decidirPonto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        pontoId: z.string().uuid(),
        escalaId: z.string().uuid(),
        status: z.enum(["aprovado", "recusado"]),
        motivo: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { empresaId } = await contextoOperacao(context.supabase, context.userId, data.escalaId);
    if (data.status === "recusado" && !data.motivo) throw new Error("Informe o motivo da recusa.");
    const { data: ponto, error } = await context.supabase
      .from("pontos")
      .update({
        status: data.status,
        motivo_recusa: data.status === "recusado" ? (data.motivo ?? null) : null,
        aprovado_por_id: context.userId,
        aprovado_em: new Date().toISOString(),
      })
      .eq("id", data.pontoId)
      .eq("escala_id", data.escalaId)
      .eq("status", "pendente")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!ponto) throw new Error("Este ponto já foi decidido.");

    // Sincroniza também no ponto-store da sessão
    atualizarStatusPontoSessao(data.escalaId, data.pontoId, data.status, data.motivo);

    await registrarAuditoria(context.supabase, {
      empresa_id: empresaId,
      ator_id: context.userId,
      ator_contexto: "organizacao",
      acao: data.status === "aprovado" ? "ponto_aprovado" : "ponto_recusado",
      recurso_tipo: "ponto",
      recurso_id: data.pontoId,
      resultado: "sucesso",
      detalhes: { escala_id: data.escalaId, motivo: data.motivo ?? null },
    });

    return { ok: true };
  });

export const lancarPontoManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        escalaId: z.string().uuid(),
        tipo: tipoPonto,
        registradoEm: z.string().datetime(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { empresaId } = await contextoOperacao(context.supabase, context.userId, data.escalaId);
    const { data: ponto, error } = await context.supabase
      .from("pontos")
      .insert({
        escala_id: data.escalaId,
        tipo: data.tipo,
        metodo: "manual",
        registrado_em: data.registradoEm,
        status: "aprovado",
        aprovado_por_id: context.userId,
        aprovado_em: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;

    await registrarAuditoria(context.supabase, {
      empresa_id: empresaId,
      ator_id: context.userId,
      ator_contexto: "organizacao",
      acao: "ponto_manual_criado",
      recurso_tipo: "ponto",
      recurso_id: ponto.id,
      resultado: "sucesso",
      detalhes: { escala_id: data.escalaId, tipo: data.tipo, registrado_em: data.registradoEm },
    });

    return { ok: true };
  });

export const rotacionarQrEvento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ eventoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const contexto = await requireCapability(context.supabase, context.userId, "eventos.gerenciar");
    const admin = await getAdminClientSafe();

    // Tenta primeiro com context.supabase (autenticado com RLS da agência)
    const { data: eventoAuth } = await context.supabase
      .from("eventos")
      .select("id, empresa_id, nome, local, data_inicio, data_fim, status")
      .eq("id", data.eventoId)
      .maybeSingle();

    let evento = eventoAuth;
    if (!evento && admin) {
      try {
        const { data: eventoAdmin } = await admin
          .from("eventos")
          .select("id, empresa_id, nome, local, data_inicio, data_fim, status")
          .eq("id", data.eventoId)
          .maybeSingle();
        evento = eventoAdmin;
      } catch {
        // ignora
      }
    }

    if (!evento || evento.empresa_id !== contexto.empresaId) {
      throw new Error("Evento não encontrado.");
    }

    const agora = Date.now();
    const geradoEm = new Date(agora);
    // Garante que o novo QR Code tenha no mínimo 12 horas de validade a partir do momento da troca
    const dozeHorasApartirDeAgora = new Date(agora + 12 * 60 * 60_000);
    const dozeHorasAposFim = evento.data_fim
      ? new Date(new Date(evento.data_fim).getTime() + 12 * 60 * 60_000)
      : null;

    const dataFinalExpira =
      dozeHorasAposFim && dozeHorasAposFim.getTime() > dozeHorasApartirDeAgora.getTime()
        ? dozeHorasAposFim
        : dozeHorasApartirDeAgora;

    const expiraEm = dataFinalExpira.toISOString();
    const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");

    // Atualiza prioritariamente via context.supabase com fallback para admin
    const { error: erroUpdateAuth } = await context.supabase
      .from("eventos")
      .update({
        qr_code_token: token,
        qr_code_gerado_em: geradoEm.toISOString(),
        qr_code_expira_em: expiraEm,
      })
      .eq("id", data.eventoId);

    if (erroUpdateAuth) {
      if (admin) {
        try {
          const { error: erroUpdateAdmin } = await admin
            .from("eventos")
            .update({
              qr_code_token: token,
              qr_code_gerado_em: geradoEm.toISOString(),
              qr_code_expira_em: expiraEm,
            })
            .eq("id", data.eventoId);

          if (erroUpdateAdmin) {
            throw new Error(`Falha ao atualizar QR Code do evento: ${erroUpdateAuth.message}`);
          }
        } catch {
          throw new Error(`Falha ao atualizar QR Code do evento: ${erroUpdateAuth.message}`);
        }
      } else {
        throw new Error(`Falha ao atualizar QR Code do evento: ${erroUpdateAuth.message}`);
      }
    }

    await registrarAuditoria(context.supabase, {
      empresa_id: evento.empresa_id,
      ator_id: context.userId,
      ator_contexto: "organizacao",
      acao: "qr_ponto_rotacionado",
      recurso_tipo: "evento",
      recurso_id: data.eventoId,
      resultado: "sucesso",
      detalhes: {
        token_gerado: token.slice(0, 8) + "...",
        expira_em: expiraEm,
      },
    });

    const signedToken = criarTokenQrCodeAssinado({
      id: evento.id,
      empresa_id: evento.empresa_id,
      nome: evento.nome,
      local: evento.local,
      status: evento.status,
      data_inicio: evento.data_inicio,
      data_fim: evento.data_fim,
      qr_code_expira_em: expiraEm,
      qr_code_token: token,
    });

    salvarSessaoEvento({
      eventoId: evento.id,
      empresaId: evento.empresa_id,
      qrCodeToken: token,
      signedToken,
      nome: evento.nome,
      local: evento.local,
      status: evento.status,
      data_inicio: evento.data_inicio,
      data_fim: evento.data_fim,
      qr_code_expira_em: expiraEm,
      exigeSelfie: false,
      exigeGps: false,
      pontoBasico: false,
      authHeader: context.authHeader ?? null,
      escalas: [],
      expiraEm: new Date(expiraEm).getTime(),
    });

    return { ok: true, token, signedToken, expiraEm };
  });
