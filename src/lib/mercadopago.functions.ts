import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCapability, requireOrganizationContext } from "@/lib/autorizacao.server";
import { verificarStatusAssinaturaEmpresa } from "@/lib/mercadopago.server";

const salvarCredenciaisSchema = z.object({
  applicationId: z.string().trim().min(3, "Application ID obrigatório"),
  publicKey: z.string().trim().optional(),
  accessToken: z.string().trim().min(8, "Access Token obrigatório"),
  clientSecret: z.string().trim().optional(),
  ambiente: z.enum(["sandbox", "producao"]).default("sandbox"),
});

export function mascararToken(token?: string | null): string {
  if (!token) return "";
  if (token.length < 12) return "••••••••";
  const inicio = token.slice(0, 8);
  const fim = token.slice(-4);
  return `${inicio}...${fim}`;
}

export const obterConfiguracaoMercadoPago = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { empresaId } = await requireCapability(
      context.supabase,
      context.userId,
      "configuracoes.gerenciar",
    );
    if (!empresaId) throw new Error("Organização não encontrada.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: conta, error } = await supabaseAdmin
      .from("mercado_pago_contas")
      .select("id, empresa_id, mercado_pago_user_id, status, escopos, criado_em, atualizado_em")
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (error) {
      throw new Error("Erro ao consultar integração do Mercado Pago.");
    }

    return {
      conectado: Boolean(conta && conta.status === "ativo"),
      conta: conta
        ? {
            id: conta.id,
            mercadoPagoUserId: conta.mercado_pago_user_id,
            status: conta.status,
            escopos: conta.escopos,
            atualizadoEm: conta.atualizado_em,
          }
        : null,
    };
  });

export const salvarCredenciaisMercadoPago = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => salvarCredenciaisSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { empresaId } = await requireCapability(
      context.supabase,
      context.userId,
      "configuracoes.gerenciar",
    );
    if (!empresaId) throw new Error("Organização não encontrada.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Armazenamento das credenciais da conta do cliente
    const userIdIdentificador = data.applicationId;
    const { data: existente } = await supabaseAdmin
      .from("mercado_pago_contas")
      .select("id")
      .eq("empresa_id", empresaId)
      .maybeSingle();

    let operacao;
    if (existente) {
      operacao = await supabaseAdmin
        .from("mercado_pago_contas")
        .update({
          mercado_pago_user_id: userIdIdentificador,
          access_token_cifrado: data.accessToken,
          escopos: JSON.stringify({
            ambiente: data.ambiente,
            publicKey: data.publicKey ?? null,
            temClientSecret: Boolean(data.clientSecret),
          }),
          status: "ativo",
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", existente.id);
    } else {
      operacao = await supabaseAdmin.from("mercado_pago_contas").insert({
        empresa_id: empresaId,
        mercado_pago_user_id: userIdIdentificador,
        access_token_cifrado: data.accessToken,
        escopos: JSON.stringify({
          ambiente: data.ambiente,
          publicKey: data.publicKey ?? null,
          temClientSecret: Boolean(data.clientSecret),
        }),
        status: "ativo",
      });
    }

    if (operacao.error) {
      throw new Error(`Falha ao salvar credenciais do Mercado Pago: ${operacao.error.message}`);
    }

    await supabaseAdmin.from("logs_auditoria").insert({
      empresa_id: empresaId,
      ator_id: context.userId,
      ator_contexto: "organizacao",
      acao: "mercado_pago_configurado",
      recurso_tipo: "mercado_pago_conta",
      resultado: "sucesso",
      detalhes: {
        ambiente: data.ambiente,
        applicationId: data.applicationId,
      },
    });

    return { ok: true, status: "ativo" };
  });

/**
 * Consulta o status da assinatura SaaS da empresa cliente via Mercado Pago.
 * Usado pelo frontend para exibir avisos de pagamento pendente ou bloqueio.
 */
export const consultarStatusAssinaturaMercadoPago = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const org = requireOrganizationContext(context);
    const empresaId = org.empresaId;
    if (!empresaId) {
      throw new Error("Agência não identificada no contexto.");
    }

    const resultado = await verificarStatusAssinaturaEmpresa(empresaId);
    return resultado;
  });
