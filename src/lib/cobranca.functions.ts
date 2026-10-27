import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOrganizationContext } from "./autorizacao.server";
import { calcularFatura } from "./cobranca-v2";

export const carregarCobranca = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    let empresaId: string | null = null;
    try {
      const org = requireOrganizationContext(context);
      empresaId = org.empresaId ?? null;
    } catch {
      // Usuário sem organização vinculada (ex: admin de plataforma ou novo cadastro)
      empresaId = null;
    }

    const agora = new Date().toISOString();
    const daqui30Dias = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();

    const fallbackRetorno = async (planosData?: unknown[]) => {
      let planosFinais = planosData;
      if (!planosFinais || !Array.isArray(planosFinais) || planosFinais.length === 0) {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: dbPlanos } = await supabaseAdmin
            .from("planos")
            .select("*")
            .eq("ativo", true)
            .order("ordem");
          planosFinais = dbPlanos ?? [];
        } catch {
          planosFinais = [];
        }
      }

      return {
        uso: {
          plano_nome: "Free",
          plano_codigo: "free",
          eventos_usados: 0,
          limite_eventos: 1 as number | null,
          participacoes_usadas: 0,
          clt_ativos: 0,
          limite_clt: null as number | null,
          limite_pessoas_evento: null as number | null,
          limite_supervisores: null as number | null,
          aviso_vendas: false,
        },
        ciclo: {
          id: null,
          plano_id: null as string | null,
          plano_nome: "Free",
          mensalidade: 0,
          participacoes_incluidas: 5,
          valor_excedente: 0,
          inicio: agora,
          fim: daqui30Dias,
          trial_ate: null as string | null,
          desconto_tipo: null as string | null,
          desconto_valor: 0,
        },
        estimativa: { total: 0, excedentes: 0, valorExcedente: 0, bruto: 0, desconto: 0 },
        faturas: [],
        planos: (planosFinais as unknown[]) ?? [],
        taxas: [],
      };
    };

    if (!empresaId) {
      return fallbackRetorno();
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Garante que o ciclo de cobrança esteja aberto
      const abertura = await supabaseAdmin.rpc("abrir_ciclo_cobranca", {
        _empresa_id: empresaId,
      });

      const [uso, ciclo, faturas, planos, taxas] = await Promise.all([
        supabaseAdmin.rpc("resumo_uso_empresa", { _empresa_id: empresaId }),
        abertura.data
          ? supabaseAdmin.from("ciclos_cobranca").select("*").eq("id", abertura.data).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabaseAdmin
          .from("faturas_plataforma")
          .select("*")
          .eq("empresa_id", empresaId)
          .order("ciclo_inicio", { ascending: false }),
        supabaseAdmin.from("planos").select("*").eq("ativo", true).order("ordem"),
        supabaseAdmin.from("taxas_meio_pagamento").select("*").eq("ativo", true),
      ]);

      const resumo = uso.data?.[0];
      const listaPlanos = planos.data ?? [];

      if (!resumo || !ciclo?.data) {
        return fallbackRetorno(listaPlanos);
      }

      const c = ciclo.data;
      const preco = {
        id: c.plano_id ?? "",
        nome: c.plano_nome,
        mensalidade: c.mensalidade ?? 0,
        participacoes_incluidas: c.participacoes_incluidas ?? 0,
        valor_excedente: c.valor_excedente ?? 0,
      };

      const bruto = calcularFatura(preco, resumo.participacoes_usadas ?? 0).bruto;
      const desconto =
        c.trial_ate && new Date(c.trial_ate) >= new Date(c.fim)
          ? bruto
          : c.desconto_tipo === "isencao"
            ? bruto
            : c.desconto_tipo === "percentual"
              ? (bruto * (c.desconto_valor ?? 0)) / 100
              : c.desconto_tipo === "valor"
                ? (c.desconto_valor ?? 0)
                : 0;

      return {
        uso: resumo,
        ciclo: c,
        estimativa: calcularFatura(preco, resumo.participacoes_usadas ?? 0, desconto),
        faturas: faturas.data ?? [],
        planos: listaPlanos,
        taxas: taxas.data ?? [],
      };
    } catch (err) {
      console.warn("[carregarCobranca] Recuperando fallback com planos:", err);
      return fallbackRetorno();
    }
  });

/**
 * Permite que a agência selecione ou troque para outro plano disponível.
 */
export const selecionarPlanoEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ planoId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const org = requireOrganizationContext(context);
    const empresaId = org.empresaId;
    if (!empresaId) throw new Error("Agência não identificada.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Valida se o plano existe e está ativo
    const { data: plano, error: planoErro } = await supabaseAdmin
      .from("planos")
      .select("*")
      .eq("id", data.planoId)
      .eq("ativo", true)
      .maybeSingle();

    if (planoErro || !plano) {
      throw new Error("Plano selecionado não encontrado ou inativo.");
    }

    // Consulta assinatura existente da agência
    const { data: assinaturaExistente } = await supabaseAdmin
      .from("assinaturas")
      .select("id, plano_id, status")
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (assinaturaExistente) {
      const { error: erroUpdate } = await supabaseAdmin
        .from("assinaturas")
        .update({
          plano_id: plano.id,
          status: "ativa",
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", assinaturaExistente.id);

      if (erroUpdate) throw new Error(erroUpdate.message);
    } else {
      const { error: erroInsert } = await supabaseAdmin.from("assinaturas").insert({
        empresa_id: empresaId,
        plano_id: plano.id,
        status: "ativa",
      });

      if (erroInsert) throw new Error(erroInsert.message);
    }

    // Abre novo ciclo com o plano escolhido
    await supabaseAdmin.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });

    // Registra log de auditoria
    await supabaseAdmin.from("logs_auditoria").insert({
      empresa_id: empresaId,
      ator_id: context.userId,
      ator_contexto: "organizacao",
      acao: "plano_alterado",
      recurso_tipo: "plano",
      recurso_id: plano.id,
      resultado: "sucesso",
      detalhes: {
        novo_plano: plano.nome,
        mensalidade: plano.mensalidade,
        participacoes_incluidas: plano.participacoes_incluidas,
      },
    });

    return { ok: true, planoNome: plano.nome };
  });
