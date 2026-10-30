import { createMiddleware } from "@tanstack/react-start";
import { requireOrganizationContext } from "./autorizacao.server";
import type { ContextoResolvido } from "./dominio";

export type StatusAssinaturaMercadoPago =
  "ativo" | "pendente" | "vencido" | "cancelado" | "trial" | "isento";

export interface ResultadoVerificacaoAssinatura {
  status: StatusAssinaturaMercadoPago;
  pago: boolean;
  bloqueado: boolean;
  motivo?: string | undefined;
  subscriptionId?: string | undefined;
  valor?: number | undefined;
  proximoVencimento?: string | null | undefined;
  detalhes?: Record<string, string | number | boolean | null | undefined> | undefined;
}

export class AssinaturaBloqueadaError extends Error {
  public readonly status: StatusAssinaturaMercadoPago;
  public readonly motivo: string;
  public readonly empresaId: string;
  public readonly codigo = "ASSINATURA_PAGAMENTO_BLOQUEADO";

  constructor(
    mensagem: string,
    detalhes: {
      status: StatusAssinaturaMercadoPago;
      motivo: string;
      empresaId: string;
    },
  ) {
    super(mensagem);
    this.name = "AssinaturaBloqueadaError";
    this.status = detalhes.status;
    this.motivo = detalhes.motivo;
    this.empresaId = detalhes.empresaId;
  }
}

// Cache em memória para evitar chamadas excessivas à API externa (TTL de 60 segundos)
interface ItemCache {
  expiraEm: number;
  resultado: ResultadoVerificacaoAssinatura;
}

const cacheVerificacoes = new Map<string, ItemCache>();

export function limparCacheAssinatura(empresaId?: string) {
  if (empresaId) {
    cacheVerificacoes.delete(empresaId);
  } else {
    cacheVerificacoes.clear();
  }
}

/**
 * Consulta a API oficial do Mercado Pago para buscar a assinatura associada.
 * Utiliza o endpoint de Preapproval (/preapproval/search ou /preapproval/{id}).
 */
export async function consultarAssinaturaMercadoPagoApi(params: {
  accessToken: string;
  subscriptionId?: string | undefined;
  empresaId: string;
}): Promise<ResultadoVerificacaoAssinatura> {
  const { accessToken, subscriptionId, empresaId } = params;

  try {
    let url = "https://api.mercadopago.com/preapproval/search";
    if (subscriptionId) {
      url = `https://api.mercadopago.com/preapproval/${encodeURIComponent(subscriptionId)}`;
    } else {
      url = `https://api.mercadopago.com/preapproval/search?external_reference=${encodeURIComponent(empresaId)}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {
          status: "vencido",
          pago: false,
          bloqueado: true,
          motivo: "Assinatura não encontrada no Mercado Pago. Contrate um plano para continuar.",
        };
      }
      const erroTexto = await response.text();
      console.warn(
        `[MercadoPago] Erro HTTP ${response.status} ao consultar assinatura: ${erroTexto}`,
      );
      return {
        status: "pendente",
        pago: false,
        bloqueado: true,
        motivo: "Falha temporária ao verificar status de pagamento no gateway Mercado Pago.",
      };
    }

    const json = await response.json();
    const dados = subscriptionId ? json : (json.results?.[0] ?? null);

    if (!dados) {
      return {
        status: "vencido",
        pago: false,
        bloqueado: true,
        motivo: "Nenhuma assinatura ativa encontrada para esta organização no Mercado Pago.",
      };
    }

    // Mercado Pago Preapproval Status:
    // "authorized" -> Assinatura ativa e com pagamento confirmado
    // "pending"    -> Pagamento pendente de aprovação ou em processamento
    // "paused"     -> Pausada por falta de pagamento ou pelo usuário
    // "cancelled"  -> Cancelada
    const mpStatus = String(dados.status || "").toLowerCase();
    const valor = Number(dados.auto_recurring?.transaction_amount ?? dados.transaction_amount ?? 0);
    const proximoVencimento = dados.next_payment_date ?? dados.date_created ?? null;

    if (mpStatus === "authorized") {
      return {
        status: "ativo",
        pago: true,
        bloqueado: false,
        subscriptionId: dados.id,
        valor,
        proximoVencimento,
        detalhes: {
          payerEmail: dados.payer_email,
          reason: dados.reason,
          statusOriginal: dados.status,
        },
      };
    }

    if (mpStatus === "pending") {
      return {
        status: "pendente",
        pago: false,
        bloqueado: true,
        subscriptionId: dados.id,
        valor,
        proximoVencimento,
        motivo: "Pagamento da assinatura do Mercado Pago está pendente de compensação.",
        detalhes: {
          statusOriginal: dados.status,
        },
      };
    }

    if (mpStatus === "paused") {
      return {
        status: "vencido",
        pago: false,
        bloqueado: true,
        subscriptionId: dados.id,
        valor,
        proximoVencimento,
        motivo: "Assinatura suspensa por falta de pagamento. Regularize para desbloquear.",
        detalhes: {
          statusOriginal: dados.status,
        },
      };
    }

    // cancelled ou outros
    return {
      status: "cancelado",
      pago: false,
      bloqueado: true,
      subscriptionId: dados.id,
      valor,
      proximoVencimento,
      motivo: "Assinatura cancelada no Mercado Pago. Assine um novo plano para reativar o acesso.",
      detalhes: {
        statusOriginal: dados.status,
      },
    };
  } catch (error) {
    console.error("[MercadoPago] Exceção ao consultar API de assinaturas:", error);
    return {
      status: "pendente",
      pago: false,
      bloqueado: true,
      motivo: "Erro de conexão ao validar pagamento da assinatura no Mercado Pago.",
    };
  }
}

/**
 * Verifica o status da assinatura de uma agência cliente.
 * 1. Respeita período de teste (Trial) ativo ou plano gratuito (Free) cadastrados no banco.
 * 2. Consulta a API do Mercado Pago caso haja integração/assinatura vinculada.
 * 3. Bloqueia funcionalidades se a assinatura estiver pendente ou vencida.
 */
export async function verificarStatusAssinaturaEmpresa(
  empresaId: string,
  options?: { forcarAtualizacao?: boolean },
): Promise<ResultadoVerificacaoAssinatura> {
  const agora = Date.now();
  if (!options?.forcarAtualizacao) {
    const itemEmCache = cacheVerificacoes.get(empresaId);
    if (itemEmCache && itemEmCache.expiraEm > agora) {
      return itemEmCache.resultado;
    }
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1. Consultar assinatura e plano da empresa no banco de dados local
  const [{ data: assinatura }, { data: mpConta }] = await Promise.all([
    supabaseAdmin
      .from("assinaturas")
      .select("*, plano:planos(*)")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabaseAdmin
      .from("mercado_pago_contas")
      .select("access_token_cifrado, status, escopos")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
  ]);

  // Se a empresa possui status explícito de isenção ou trial ativo no banco
  if (assinatura) {
    if (assinatura.trial_ate && new Date(assinatura.trial_ate).getTime() > agora) {
      const res: ResultadoVerificacaoAssinatura = {
        status: "trial",
        pago: true,
        bloqueado: false,
        proximoVencimento: assinatura.trial_ate,
        motivo: "Período de avaliação gratuito ativo (7 dias).",
      };
      cacheVerificacoes.set(empresaId, {
        resultado: res,
        expiraEm: agora + 60_000,
      });
      return res;
    }

    // Se o período de teste expirou e não possui plano pago confirmado
    if (assinatura.trial_ate && new Date(assinatura.trial_ate).getTime() <= agora) {
      const ehPlanoComercialAtivo =
        assinatura.status === "ativa" &&
        assinatura.plano &&
        (assinatura.plano as { mensalidade?: number }).mensalidade! > 0;

      if (!ehPlanoComercialAtivo) {
        const res: ResultadoVerificacaoAssinatura = {
          status: "vencido",
          pago: false,
          bloqueado: true,
          proximoVencimento: assinatura.trial_ate,
          motivo:
            "Seu período de teste gratuito de 7 dias encerrou. Escolha um plano para continuar ou solicite extensão de prazo à administração.",
        };
        cacheVerificacoes.set(empresaId, {
          resultado: res,
          expiraEm: agora + 30_000,
        });
        return res;
      }
    }

    if (assinatura.status === "bloqueada") {
      const res: ResultadoVerificacaoAssinatura = {
        status: "vencido",
        pago: false,
        bloqueado: true,
        motivo: "Assinatura bloqueada administrativamente.",
      };
      cacheVerificacoes.set(empresaId, {
        resultado: res,
        expiraEm: agora + 30_000,
      });
      return res;
    }
  }

  // 2. Obter token do Mercado Pago da plataforma ou da conta conectada
  const tokenPlataforma =
    process.env["MERCADOPAGO_ACCESS_TOKEN"] ||
    process.env["MERCADO_PAGO_ACCESS_TOKEN"] ||
    process.env["MP_ACCESS_TOKEN"];

  const tokenEfetivo = tokenPlataforma || mpConta?.access_token_cifrado;

  // Se não houver token do Mercado Pago configurado em ambiente de desenvolvimento,
  // ou for plano Free sem provedor de cobrança, não bloqueia por padrão
  if (!tokenEfetivo) {
    const isFree = assinatura?.plano?.codigo === "free" || assinatura?.plano?.mensalidade === 0;
    const res: ResultadoVerificacaoAssinatura = {
      status: isFree ? "isento" : "ativo",
      pago: true,
      bloqueado: false,
      motivo: isFree ? "Plano gratuito sem cobrança." : "Ambiente sem gateway.",
    };
    cacheVerificacoes.set(empresaId, {
      resultado: res,
      expiraEm: agora + 60_000,
    });
    return res;
  }

  // Extrair subscriptionId se estiver registrado em observações ou escopos
  let subscriptionId: string | undefined;
  if (assinatura?.observacoes) {
    try {
      const obs = JSON.parse(assinatura.observacoes);
      if (obs?.mp_preapproval_id || obs?.subscriptionId) {
        subscriptionId = obs.mp_preapproval_id || obs.subscriptionId;
      }
    } catch {
      // observações puras de texto
    }
  }

  // 3. Consultar API do Mercado Pago
  const resultadoApi = await consultarAssinaturaMercadoPagoApi({
    accessToken: tokenEfetivo,
    subscriptionId,
    empresaId,
  });

  // Gravar no cache por 60 segundos
  cacheVerificacoes.set(empresaId, {
    resultado: resultadoApi,
    expiraEm: agora + 60_000,
  });

  // Se estiver bloqueado, sincronizar com o status da assinatura no banco se aplicável
  if (resultadoApi.bloqueado && assinatura?.id) {
    const novoStatusBanco = resultadoApi.status === "cancelado" ? "cancelada" : "bloqueada";
    if (assinatura.status !== novoStatusBanco && assinatura.status !== "trial") {
      await supabaseAdmin
        .from("assinaturas")
        .update({
          status: novoStatusBanco,
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", assinatura.id);
    }
  }

  return resultadoApi;
}

/**
 * Função utilitária para chamar antes de executar operações pagas ou sensíveis.
 * Dispara AssinaturaBloqueadaError caso o pagamento esteja pendente ou vencido.
 */
export async function exigirAssinaturaAtiva(empresaId: string): Promise<void> {
  const verificacao = await verificarStatusAssinaturaEmpresa(empresaId);
  if (verificacao.bloqueado) {
    throw new AssinaturaBloqueadaError(
      verificacao.motivo ??
        "Funcionalidade bloqueada: Pagamento da assinatura pendente ou vencido no Mercado Pago.",
      {
        status: verificacao.status,
        motivo: verificacao.motivo ?? "Regularize a fatura da assinatura para continuar.",
        empresaId,
      },
    );
  }
}

/**
 * Middleware TanStack Start para rotas e server functions protegidas por assinatura.
 * Pode ser encadeado após `requireSupabaseAuth`.
 *
 * Exemplo de uso:
 * ```ts
 * export const criarEvento = createServerFn({ method: "POST" })
 *   .middleware([requireSupabaseAuth, requireMercadoPagoAssinaturaAtiva])
 *   .handler(async ({ context, data }) => { ... })
 * ```
 */
export const requireMercadoPagoAssinaturaAtiva = createMiddleware({
  type: "function",
}).server(async ({ next, context }) => {
  const org = requireOrganizationContext(
    context as unknown as { contexto?: ContextoResolvido | null },
  );
  const empresaId = org.empresaId;

  if (!empresaId) {
    throw new Error("Contexto de organização necessário para validar assinatura.");
  }

  const resultado = await verificarStatusAssinaturaEmpresa(empresaId);

  if (resultado.bloqueado) {
    throw new AssinaturaBloqueadaError(
      resultado.motivo ??
        "Acesso bloqueado: Pagamento da assinatura do Mercado Pago está pendente ou vencido.",
      {
        status: resultado.status,
        motivo:
          resultado.motivo ?? "Regularize o pagamento no Mercado Pago para liberar esta operação.",
        empresaId,
      },
    );
  }

  return next({
    context: {
      assinaturaMercadoPago: resultado,
    },
  });
});
