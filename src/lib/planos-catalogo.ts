/**
 * Catálogo e regras dos Planos da plataforma Já — Gestão de Equipes e Pagamentos.
 * Garante que o plano gratuito de 7 dias e os planos comerciais
 * estejam sempre disponíveis na interface, onboarding e validações de cobrança.
 */

export const DIAS_TRIAL_PADRAO = 7;

export interface PlanoItem {
  id: string;
  codigo: string;
  nome: string;
  descricao: string;
  mensalidade: number;
  dias_trial: number;
  participacoes_incluidas: number;
  valor_excedente: number;
  limite_eventos_ciclo: number | null;
  limite_pessoas_evento: number | null;
  limite_clt: number | null;
  limite_supervisores: number | null;
  destaque?: string;
  badge?: string;
  recursos: Record<string, boolean>;
}

export const PLANOS_CATALOGO: PlanoItem[] = [
  {
    id: "plano-trial-7dias",
    codigo: "free",
    nome: "Plano Gratuito (7 dias)",
    descricao:
      "Acesso completo durante 7 dias para testar todas as funcionalidades de gestão, ponto digital e pagamentos.",
    mensalidade: 0,
    dias_trial: DIAS_TRIAL_PADRAO,
    participacoes_incluidas: 20,
    valor_excedente: 2.5,
    limite_eventos_ciclo: 5,
    limite_pessoas_evento: 30,
    limite_clt: 2,
    limite_supervisores: 2,
    destaque: "7 dias grátis · Sem cartão agora",
    badge: "Teste Grátis",
    recursos: {
      fechamento: true,
      financeiro: true,
      relatorios_avancados: true,
      importacao_excel: true,
    },
  },
  {
    id: "plano-starter",
    codigo: "starter",
    nome: "Starter",
    descricao: "Para agências em expansão com foco em operações pontuais e equipes sob demanda.",
    mensalidade: 99,
    dias_trial: 0,
    participacoes_incluidas: 50,
    valor_excedente: 2.0,
    limite_eventos_ciclo: 15,
    limite_pessoas_evento: 50,
    limite_clt: 5,
    limite_supervisores: 3,
    recursos: {
      fechamento: true,
      financeiro: true,
      relatorios_avancados: true,
      importacao_excel: true,
    },
  },
  {
    id: "plano-pro",
    codigo: "pro",
    nome: "Profissional",
    descricao: "Para agências consolidadas com alto volume de escalas, eventos semanais e equipe.",
    mensalidade: 199,
    dias_trial: 0,
    participacoes_incluidas: 150,
    valor_excedente: 1.5,
    limite_eventos_ciclo: null,
    limite_pessoas_evento: null,
    limite_clt: 20,
    limite_supervisores: 10,
    badge: "Mais Escolhido",
    recursos: {
      fechamento: true,
      financeiro: true,
      agendamento_pix: true,
      pix_massa: true,
      relatorios_avancados: true,
      exportacao_avancada: true,
      importacao_excel: true,
      suporte_prioritario: true,
    },
  },
  {
    id: "plano-enterprise",
    codigo: "enterprise",
    nome: "Corporativo",
    descricao: "Estrutura completa, franquia ampla, API aberta e atendimento preferencial.",
    mensalidade: 399,
    dias_trial: 0,
    participacoes_incluidas: 400,
    valor_excedente: 1.2,
    limite_eventos_ciclo: null,
    limite_pessoas_evento: null,
    limite_clt: null,
    limite_supervisores: null,
    recursos: {
      fechamento: true,
      financeiro: true,
      agendamento_pix: true,
      pix_massa: true,
      relatorios_avancados: true,
      exportacao_avancada: true,
      importacao_excel: true,
      api: true,
      suporte_prioritario: true,
    },
  },
];

/**
 * Calcula a data limite do período de teste gratuito (7 dias).
 */
export function calcularDataFimTrial(dias = DIAS_TRIAL_PADRAO): string {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  return data.toISOString();
}

/**
 * Valida se um trial ainda está ativo.
 */
export function trialEstaAtivo(trialAte?: string | null): boolean {
  if (!trialAte) return false;
  return new Date(trialAte).getTime() > Date.now();
}
