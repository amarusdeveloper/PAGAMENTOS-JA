import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClientSafe } from "@/lib/auth.functions";
import { calcularDataFimTrial, DIAS_TRIAL_PADRAO, PLANOS_CATALOGO } from "@/lib/planos-catalogo";

const concluirOnboardingSchema = z.object({
  nomeEmpresa: z.string().trim().min(2, "Nome da agência deve ter no mínimo 2 caracteres"),
  cnpj: z.string().trim().min(11, "Documento deve ter pelo menos 11 dígitos"),
  planoCodigo: z.string().default("free"),
  planoId: z.string().optional(),
});

export const concluirCadastroComEmpresaEPlano = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => concluirOnboardingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const client = context.supabase;
    const admin = await getAdminClientSafe();
    const db = admin || client;
    const userId = context.userId;

    const cnpjLimpo = data.cnpj.replace(/\D+/g, "");

    // 1. Garante que o registro do usuário exista
    const { data: usuarioAuth } = await client.auth.getUser();
    const userEmail = usuarioAuth?.user?.email || "";
    const userNome =
      ((usuarioAuth?.user?.user_metadata as Record<string, unknown> | undefined)?.[
        "nome"
      ] as string) || data.nomeEmpresa;

    await db.from("usuarios").upsert({
      id: userId,
      email: userEmail,
      nome: userNome,
      ativo: true,
    });

    // 2. Cria a empresa pelo RPC oficial se o usuário ainda não tiver uma
    let empresaId: string | null = null;
    const { data: userRow } = await db
      .from("usuarios")
      .select("empresa_id")
      .eq("id", userId)
      .maybeSingle();

    if (userRow?.empresa_id) {
      empresaId = userRow.empresa_id;
    } else {
      const { data: novaEmpresaId, error: erroCriar } = await client.rpc("criar_empresa", {
        _nome: data.nomeEmpresa.trim(),
        _cnpj: cnpjLimpo,
      });

      if (erroCriar) {
        throw new Error(`Falha ao cadastrar a agência: ${erroCriar.message}`);
      }
      empresaId = novaEmpresaId;
    }

    if (!empresaId) {
      throw new Error("Não foi possível identificar a agência criada.");
    }

    // 3. Identifica plano escolhido
    const planoEscolhido =
      PLANOS_CATALOGO.find((p) => p.codigo === data.planoCodigo) || PLANOS_CATALOGO[0];

    const ehGratuito = planoEscolhido.codigo === "free" || planoEscolhido.mensalidade === 0;

    // Se o plano for o gratuito, aplica exatamente 7 dias de trial
    const trialAte = ehGratuito ? calcularDataFimTrial(DIAS_TRIAL_PADRAO) : null;

    // 4. Cria ou atualiza assinatura
    const { data: assinaturaExistente } = await db
      .from("assinaturas")
      .select("id")
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (assinaturaExistente) {
      await db
        .from("assinaturas")
        .update({
          status: ehGratuito ? "trial" : "ativa",
          trial_ate: trialAte,
          observacoes: ehGratuito
            ? `Plano gratuito com ${DIAS_TRIAL_PADRAO} dias de teste completo.`
            : `Plano ${planoEscolhido.nome} selecionado no cadastro.`,
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", assinaturaExistente.id);
    } else {
      await db.from("assinaturas").insert({
        empresa_id: empresaId,
        status: ehGratuito ? "trial" : "ativa",
        trial_ate: trialAte,
        inicio_ciclo: new Date().toISOString(),
        observacoes: ehGratuito
          ? `Plano gratuito com ${DIAS_TRIAL_PADRAO} dias de teste completo.`
          : `Plano ${planoEscolhido.nome} selecionado no cadastro.`,
      });
    }

    // 5. Tenta abrir ciclo de cobrança inicial
    try {
      await client.rpc("abrir_ciclo_cobranca", { _empresa_id: empresaId });
    } catch {
      // ciclo será aberto no primeiro acesso se necessário
    }

    // 6. Auditoria
    try {
      await db.from("logs_auditoria").insert({
        empresa_id: empresaId,
        ator_id: userId,
        ator_contexto: "organizacao",
        acao: "onboarding_concluido",
        recurso_tipo: "empresa",
        recurso_id: empresaId,
        resultado: "sucesso",
        detalhes: {
          nome: data.nomeEmpresa,
          plano: planoEscolhido.nome,
          ehGratuito,
          diasTrial: ehGratuito ? DIAS_TRIAL_PADRAO : 0,
          trialAte,
        },
      });
    } catch {
      // prossegue
    }

    return {
      sucesso: true,
      empresaId,
      planoCodigo: planoEscolhido.codigo,
      planoNome: planoEscolhido.nome,
      trialAte,
    };
  });
