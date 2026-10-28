import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Database, Tables } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOrganizationContext } from "./autorizacao.server";
import { calcularFatura } from "./cobranca-v2";

type PlanoRow = Tables<"planos">;
type FaturaRow = Tables<"faturas_plataforma">;
type TaxaRow = Tables<"taxas_meio_pagamento">;
type CicloRow = Tables<"ciclos_cobranca">;
type ResumoUso = Database["public"]["Functions"]["resumo_uso_empresa"]["Returns"][number];

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

    const fallbackRetorno = async (planosData?: PlanoRow[]) => {
      let planosFinais = planosData;
      if (!planosFinais || !Array.isArray(planosFinais) || planosFinais.length === 0) {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: dbPlanos } = await supabaseAdmin
            .from("planos")
            .select("*")
            .eq("ativo", true)
            .order("ordem");
          planosFinais = (dbPlanos ?? []) as PlanoRow[];
        } catch {
          planosFinais = [] as PlanoRow[];
        }
      }

      const usoFallback: ResumoUso = {
        aviso_vendas: false,
        ciclo_fim: daqui30Dias,
        ciclo_inicio: agora,
        clt_ativos: 0,
        estimativa: 0,
        eventos_usados: 0,
        limite_clt: 0,
        limite_eventos: 1,
        limite_pessoas_evento: 0,
        limite_supervisores: 0,
        mensalidade: 0,
        participacoes_excedentes: 0,
        participacoes_incluidas: 5,
        participacoes_usadas: 0,
        plano_codigo: "free",
        plano_id: "",
        plano_nome: "Free",
        recursos: {},
        valor_excedente: 0,
      };

      const cicloFallback: CicloRow = {
        id: "",
        assinatura_id: null,
        empresa_id: empresaId ?? "",
        plano_id: null,
        plano_nome: "Free",
        mensalidade: 0,
        participacoes_incluidas: 5,
        valor_excedente: 0,
        inicio: agora,
        fim: daqui30Dias,
        trial_ate: null,
        desconto_tipo: null,
        desconto_valor: 0,
        criado_em: agora,
      };

      return {
        uso: usoFallback,
        ciclo: cicloFallback,
        estimativa: { total: 0, excedentes: 0, valorExcedente: 0, bruto: 0, desconto: 0 },
        faturas: [] as FaturaRow[],
        planos: (planosFinais ?? []) as PlanoRow[],
        taxas: [] as TaxaRow[],
      };
    };

    if (!empresaId) {
      return fallbackRetorno();
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const client = context.supabase;

      // Garante que o ciclo de cobrança esteja aberto
      let abertura = await client.rpc("abrir_ciclo_cobranca", {
        _empresa_id: empresaId,
      });
      if (abertura.error) {
        abertura = await supabaseAdmin.rpc("abrir_ciclo_cobranca", {
          _empresa_id: empresaId,
        });
      }

      const [uso, ciclo, faturas, planos, taxas] = await Promise.all([
        client.rpc("resumo_uso_empresa", { _empresa_id: empresaId }).then(async (r) => {
          if (r.error || !r.data)
            return supabaseAdmin.rpc("resumo_uso_empresa", { _empresa_id: empresaId });
          return r;
        }),
        abertura.data
          ? client
              .from("ciclos_cobranca")
              .select("*")
              .eq("id", abertura.data)
              .maybeSingle()
              .then(async (r) => {
                if (r.error || !r.data) {
                  return supabaseAdmin
                    .from("ciclos_cobranca")
                    .select("*")
                    .eq("id", abertura.data)
                    .maybeSingle();
                }
                return r;
              })
          : Promise.resolve({ data: null, error: null }),
        client
          .from("faturas_plataforma")
          .select("*")
          .eq("empresa_id", empresaId)
          .order("ciclo_inicio", { ascending: false })
          .then(async (r) => {
            if (r.error) {
              return supabaseAdmin
                .from("faturas_plataforma")
                .select("*")
                .eq("empresa_id", empresaId)
                .order("ciclo_inicio", { ascending: false });
            }
            return r;
          }),
        client
          .from("planos")
          .select("*")
          .eq("ativo", true)
          .order("ordem")
          .then(async (r) => {
            if (r.error || !r.data?.length) {
              return supabaseAdmin.from("planos").select("*").eq("ativo", true).order("ordem");
            }
            return r;
          }),
        client
          .from("taxas_meio_pagamento")
          .select("*")
          .eq("ativo", true)
          .then(async (r) => {
            if (r.error) {
              return supabaseAdmin.from("taxas_meio_pagamento").select("*").eq("ativo", true);
            }
            return r;
          }),
      ]);

      const resumo = uso.data?.[0];
      const listaPlanos = (planos.data && planos.data.length > 0 ? planos.data : []) as PlanoRow[];

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
        faturas: (faturas.data ?? []) as FaturaRow[],
        planos: listaPlanos,
        taxas: (taxas.data ?? []) as TaxaRow[],
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
    const client = context.supabase;

    // Valida se o plano existe e está ativo
    let { data: plano } = await client
      .from("planos")
      .select("*")
      .eq("id", data.planoId)
      .eq("ativo", true)
      .maybeSingle();

    if (!plano) {
      const resAdmin = await supabaseAdmin
        .from("planos")
        .select("*")
        .eq("id", data.planoId)
        .eq("ativo", true)
        .maybeSingle();
      plano = resAdmin.data;
    }

    if (!plano) {
      throw new Error("Plano selecionado não encontrado ou inativo.");
    }

    // Consulta assinatura existente da agência
    let { data: assinaturaExistente } = await client
      .from("assinaturas")
      .select("id, plano_id, status")
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (!assinaturaExistente) {
      const resAssAdmin = await supabaseAdmin
        .from("assinaturas")
        .select("id, plano_id, status")
        .eq("empresa_id", empresaId)
        .maybeSingle();
      assinaturaExistente = resAssAdmin.data;
    }

    if (assinaturaExistente) {
      const { error: erroUpdate } = await client
        .from("assinaturas")
        .update({
          plano_id: plano.id,
          status: "ativa",
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", assinaturaExistente.id);

      if (erroUpdate) {
        const { error: erroAdmin } = await supabaseAdmin
          .from("assinaturas")
          .update({
            plano_id: plano.id,
            status: "ativa",
            atualizado_em: new Date().toISOString(),
          })
          .eq("id", assinaturaExistente.id);
        if (erroAdmin) throw new Error(erroAdmin.message);
      }
    } else {
      const { error: erroInsert } = await client.from("assinaturas").insert({
        empresa_id: empresaId,
        plano_id: plano.id,
        status: "ativa",
      });

      if (erroInsert) {
        const { error: erroAdmin } = await supabaseAdmin.from("assinaturas").insert({
          empresa_id: empresaId,
          plano_id: plano.id,
          status: "ativa",
        });
        if (erroAdmin) throw new Error(erroAdmin.message);
      }
    }

    // Abre novo ciclo com o plano escolhido
    try {
      const resCiclo = await client.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
      if (resCiclo.error) {
        await supabaseAdmin.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
      }
    } catch {
      try {
        await supabaseAdmin.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
      } catch {
        // Ignora
      }
    }

    // Registra log de auditoria
    const auditPayload = {
      empresa_id: empresaId,
      ator_id: context.userId,
      ator_contexto: "organizacao",
      acao: "plano_alterado",
      recurso_tipo: "plano",
      recurso_id: plano.id,
      resultado: "sucesso",
      detalhes: {
        plano_id: plano.id,
        plano_nome: plano.nome,
        mensalidade: plano.mensalidade,
      },
    };
    try {
      const resAudit = await client.from("logs_auditoria").insert(auditPayload);
      if (resAudit.error) {
        await supabaseAdmin.from("logs_auditoria").insert(auditPayload);
      }
    } catch {
      try {
        await supabaseAdmin.from("logs_auditoria").insert(auditPayload);
      } catch {
        // Ignora
      }
    }

    return { ok: true, planoNome: plano.nome };
  });
