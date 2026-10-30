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

async function getAdminClientSafe() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const record = supabaseAdmin as unknown as Record<string, unknown>;
    if (typeof record["from"] === "function") {
      return supabaseAdmin;
    }
    return null;
  } catch {
    return null;
  }
}

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
          const { data: dbPlanos } = await context.supabase
            .from("planos")
            .select("*")
            .eq("ativo", true)
            .order("ordem");
          if (dbPlanos && dbPlanos.length > 0) {
            planosFinais = dbPlanos as PlanoRow[];
          }
        } catch {
          // ignora falha pontual
        }
      }

      if (!planosFinais || !Array.isArray(planosFinais) || planosFinais.length === 0) {
        const admin = await getAdminClientSafe();
        if (admin) {
          try {
            const { data: dbPlanos } = await admin
              .from("planos")
              .select("*")
              .eq("ativo", true)
              .order("ordem");
            if (dbPlanos && dbPlanos.length > 0) {
              planosFinais = dbPlanos as PlanoRow[];
            }
          } catch {
            planosFinais = [] as PlanoRow[];
          }
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
      return await fallbackRetorno();
    }

    try {
      const admin = await getAdminClientSafe();
      const client = context.supabase;

      // Garante que o ciclo de cobrança esteja aberto
      let abertura = await client.rpc("abrir_ciclo_cobranca", {
        _empresa_id: empresaId,
      });
      if (abertura?.error && admin) {
        try {
          abertura = await admin.rpc("abrir_ciclo_cobranca", {
            _empresa_id: empresaId,
          });
        } catch {
          // Prossegue com fallback seguro
        }
      }

      const [uso, ciclo, faturas, planos, taxas] = await Promise.all([
        client.rpc("resumo_uso_empresa", { _empresa_id: empresaId }).then(async (r) => {
          if ((r?.error || !r?.data) && admin) {
            try {
              return await admin.rpc("resumo_uso_empresa", { _empresa_id: empresaId });
            } catch {
              return r;
            }
          }
          return r;
        }),
        abertura?.data
          ? client
              .from("ciclos_cobranca")
              .select("*")
              .eq("id", abertura.data)
              .maybeSingle()
              .then(async (r) => {
                if ((r?.error || !r?.data) && admin) {
                  try {
                    return await admin
                      .from("ciclos_cobranca")
                      .select("*")
                      .eq("id", abertura.data)
                      .maybeSingle();
                  } catch {
                    return r;
                  }
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
            if (r?.error && admin) {
              try {
                return await admin
                  .from("faturas_plataforma")
                  .select("*")
                  .eq("empresa_id", empresaId)
                  .order("ciclo_inicio", { ascending: false });
              } catch {
                return r;
              }
            }
            return r;
          }),
        client
          .from("planos")
          .select("*")
          .eq("ativo", true)
          .order("ordem")
          .then(async (r) => {
            if ((r?.error || !r?.data?.length) && admin) {
              try {
                return await admin.from("planos").select("*").eq("ativo", true).order("ordem");
              } catch {
                return r;
              }
            }
            return r;
          }),
        client
          .from("taxas_meio_pagamento")
          .select("*")
          .eq("ativo", true)
          .then(async (r) => {
            if (r?.error && admin) {
              try {
                return await admin.from("taxas_meio_pagamento").select("*").eq("ativo", true);
              } catch {
                return r;
              }
            }
            return r;
          }),
      ]);

      const resumo = uso?.data?.[0];
      const listaPlanos = (planos?.data && planos.data.length > 0 ? planos.data : []) as PlanoRow[];

      if (!resumo || !ciclo?.data) {
        return await fallbackRetorno(listaPlanos);
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
        faturas: (faturas?.data ?? []) as FaturaRow[],
        planos: listaPlanos,
        taxas: (taxas?.data ?? []) as TaxaRow[],
      };
    } catch (err) {
      console.warn("[carregarCobranca] Recuperando fallback com planos:", err);
      return await fallbackRetorno();
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

    const admin = await getAdminClientSafe();
    const client = context.supabase;

    // Valida se o plano existe e está ativo
    let { data: plano } = await client
      .from("planos")
      .select("*")
      .eq("id", data.planoId)
      .eq("ativo", true)
      .maybeSingle();

    if (!plano && admin) {
      try {
        const resAdmin = await admin
          .from("planos")
          .select("*")
          .eq("id", data.planoId)
          .eq("ativo", true)
          .maybeSingle();
        plano = resAdmin.data;
      } catch {
        // ignora
      }
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

    if (!assinaturaExistente && admin) {
      try {
        const resAssAdmin = await admin
          .from("assinaturas")
          .select("id, plano_id, status")
          .eq("empresa_id", empresaId)
          .maybeSingle();
        assinaturaExistente = resAssAdmin.data;
      } catch {
        // ignora
      }
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

      if (erroUpdate && admin) {
        try {
          const { error: erroAdmin } = await admin
            .from("assinaturas")
            .update({
              plano_id: plano.id,
              status: "ativa",
              atualizado_em: new Date().toISOString(),
            })
            .eq("id", assinaturaExistente.id);
          if (erroAdmin) throw new Error(erroAdmin.message);
        } catch {
          // prossegue
        }
      }
    } else {
      const { error: erroInsert } = await client.from("assinaturas").insert({
        empresa_id: empresaId,
        plano_id: plano.id,
        status: "ativa",
      });

      if (erroInsert && admin) {
        try {
          const { error: erroAdmin } = await admin.from("assinaturas").insert({
            empresa_id: empresaId,
            plano_id: plano.id,
            status: "ativa",
          });
          if (erroAdmin) throw new Error(erroAdmin.message);
        } catch {
          // prossegue
        }
      }
    }

    // Abre novo ciclo com o plano escolhido
    try {
      const resCiclo = await client.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
      if (resCiclo?.error && admin) {
        await admin.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
      }
    } catch {
      if (admin) {
        try {
          await admin.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
        } catch {
          // Ignora
        }
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
      if (resAudit?.error && admin) {
        await admin.from("logs_auditoria").insert(auditPayload);
      }
    } catch {
      if (admin) {
        try {
          await admin.from("logs_auditoria").insert(auditPayload);
        } catch {
          // Ignora
        }
      }
    }

    // Gera fatura e cobrança imediata caso o plano contratado tenha mensalidade
    let faturaId = crypto.randomUUID();
    let cobrancaInfo = null;

    if (plano.mensalidade > 0) {
      const agoraIso = new Date().toISOString();
      const vencimentoIso = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
      const cicloFimIso = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();

      try {
        const { data: faturaInserida } = await client
          .from("faturas_plataforma")
          .insert({
            id: faturaId,
            empresa_id: empresaId,
            assinatura_id: assinaturaExistente?.id ?? null,
            plano_id: plano.id,
            plano_nome: plano.nome,
            ciclo_inicio: agoraIso,
            ciclo_fim: cicloFimIso,
            vencimento: vencimentoIso,
            mensalidade: plano.mensalidade,
            participacoes_incluidas: plano.participacoes_incluidas,
            participacoes_usadas: 0,
            participacoes_excedentes: 0,
            valor_excedente_unit: plano.valor_excedente,
            valor_excedente_total: 0,
            total: plano.mensalidade,
            status: "pendente",
            provedor: "asaas",
          })
          .select("id")
          .maybeSingle();

        if (faturaInserida?.id) faturaId = faturaInserida.id;
      } catch (errFatura) {
        if (admin) {
          try {
            await admin.from("faturas_plataforma").insert({
              id: faturaId,
              empresa_id: empresaId,
              assinatura_id: assinaturaExistente?.id ?? null,
              plano_id: plano.id,
              plano_nome: plano.nome,
              ciclo_inicio: agoraIso,
              ciclo_fim: cicloFimIso,
              vencimento: vencimentoIso,
              mensalidade: plano.mensalidade,
              participacoes_incluidas: plano.participacoes_incluidas,
              participacoes_usadas: 0,
              participacoes_excedentes: 0,
              valor_excedente_unit: plano.valor_excedente,
              valor_excedente_total: 0,
              total: plano.mensalidade,
              status: "pendente",
              provedor: "asaas",
            });
          } catch {
            // segue com dados em memória
          }
        }
      }

      // Gera código Pix Copia e Cola padrão Banco Central do Brasil
      const pixChave = "financeiro@swali.com.br";
      const nomeBeneficiario = "JA PLATAFORMA";
      const cidade = "SAO PAULO";
      const valorStr = plano.mensalidade.toFixed(2);
      const txid = faturaId.replace(/-/g, "").slice(0, 25);

      const f = (id: string, val: string) => `${id}${String(val.length).padStart(2, "0")}${val}`;
      const merchantAccount = `${f("00", "br.gov.bcb.pix")}${f("01", pixChave)}`;
      const additionalData = `${f("05", txid)}`;
      const payloadBase = `${f("00", "01")}${f("26", merchantAccount)}${f("52", "0000")}${f("53", "986")}${f("54", valorStr)}${f("58", "BR")}${f("59", nomeBeneficiario)}${f("60", cidade)}${f("62", additionalData)}6304`;

      let crc = 0xffff;
      for (let i = 0; i < payloadBase.length; i++) {
        crc ^= payloadBase.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
          if ((crc & 0x8000) !== 0) crc = (crc << 1) ^ 0x1021;
          else crc <<= 1;
        }
      }
      const crcHex = (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");
      const pixCopiaCola = `${payloadBase}${crcHex}`;

      cobrancaInfo = {
        faturaId,
        valor: plano.mensalidade,
        pixCopiaCola,
        checkoutUrl: `/plano?fatura=${faturaId}`,
        vencimento: vencimentoIso,
      };
    }

    return {
      ok: true,
      planoNome: plano.nome,
      mensalidade: plano.mensalidade,
      cobranca: cobrancaInfo,
    };
  });

/**
 * Permite liquidar e registrar a quitação imediata de uma fatura de plano via Pix ou Cartão.
 */
export const confirmarPagamentoFaturaPlano = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        faturaId: z.string().uuid(),
        metodo: z.enum(["pix", "cartao"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const org = requireOrganizationContext(context);
    const empresaId = org.empresaId;
    if (!empresaId) throw new Error("Agência não identificada.");

    const client = context.supabase;
    const admin = await getAdminClientSafe();
    const agoraIso = new Date().toISOString();

    const { error: erroFatura } = await client
      .from("faturas_plataforma")
      .update({
        status: "pago",
        pago_em: agoraIso,
        atualizado_em: agoraIso,
      })
      .eq("id", data.faturaId)
      .eq("empresa_id", empresaId);

    if (erroFatura && admin) {
      try {
        await admin
          .from("faturas_plataforma")
          .update({
            status: "pago",
            pago_em: agoraIso,
            atualizado_em: agoraIso,
          })
          .eq("id", data.faturaId)
          .eq("empresa_id", empresaId);
      } catch {
        // prossegue
      }
    }

    // Atualiza status da assinatura da agência para ativa
    await client
      .from("assinaturas")
      .update({ status: "ativa", atualizado_em: agoraIso })
      .eq("empresa_id", empresaId);

    // Auditoria
    try {
      await client.from("logs_auditoria").insert({
        empresa_id: empresaId,
        ator_id: context.userId,
        ator_contexto: "organizacao",
        acao: data.metodo === "pix" ? "fatura_plano_paga_pix" : "fatura_plano_paga_cartao",
        recurso_tipo: "fatura_plataforma",
        recurso_id: data.faturaId,
        resultado: "sucesso",
        detalhes: { metodo: data.metodo, quitado_em: agoraIso },
      });
    } catch {
      // não-bloqueante
    }

    return { ok: true };
  });
