import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  CreditCard,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatarCnpjOuCpf, moeda } from "@/lib/dominio";
import { concluirCadastroComEmpresaEPlano } from "@/lib/onboarding.functions";
import { DIAS_TRIAL_PADRAO, PLANOS_CATALOGO } from "@/lib/planos-catalogo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Cadastrar Agência e Escolher Plano — Já" },
      {
        name: "description",
        content:
          "Cadastre sua agência no Já, selecione seu plano inicial (com 7 dias de teste gratuito) e comece a escalar equipes, registrar ponto e pagar colaboradores.",
      },
      { property: "og:title", content: "Cadastrar Agência e Escolher Plano — Já" },
      {
        property: "og:description",
        content: "Primeiro passo no Já: cadastre sua agência e selecione seu plano com 7 dias grátis.",
      },
    ],
  }),
  component: Onboarding,
});

function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const concluirFn = useServerFn(concluirCadastroComEmpresaEPlano);

  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [planoCodigo, setPlanoCodigo] = useState("free");
  const [salvando, setSalvando] = useState(false);

  async function handleConcluir(e: React.FormEvent) {
    e.preventDefault();

    if (!nome.trim()) {
      toast.error("Informe o nome da sua agência.");
      return;
    }

    const docLimpo = cnpj.replace(/\D+/g, "");
    if (docLimpo.length < 11) {
      toast.error("Informe um CNPJ (14 dígitos) ou CPF (11 dígitos) válido.");
      return;
    }

    setSalvando(true);
    try {
      const res = await concluirFn({
        data: {
          nomeEmpresa: nome.trim(),
          cnpj: docLimpo,
          planoCodigo,
        },
      });

      await queryClient.invalidateQueries();

      if (res.planoCodigo === "free") {
        toast.success(
          `Agência criada com sucesso! Você tem ${DIAS_TRIAL_PADRAO} dias de acesso gratuito liberados.`,
        );
      } else {
        toast.success(
          `Agência criada e plano ${res.planoNome} selecionado! Bem-vindo ao Já.`,
        );
      }

      navigate({ to: "/painel", replace: true });
    } catch (err) {
      setSalvando(false);
      toast.error(
        err instanceof Error ? err.message : "Erro ao concluir cadastro da agência.",
      );
    }
  }

  const planoAtivo = PLANOS_CATALOGO.find((p) => p.codigo === planoCodigo) || PLANOS_CATALOGO[0];

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-between bg-slate-50 dark:bg-slate-950 px-4 py-8 sm:px-6 sm:py-12">
      <div className="w-full max-w-4xl my-auto">
        {/* Cabeçalho */}
        <div className="mb-8 text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-300">
            <ShieldCheck className="size-3.5 text-blue-600" />
            <span>Configuração Inicial da Conta</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            Cadastre sua Agência e Escolha seu Plano
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            Comece com o <strong>Plano Gratuito de {DIAS_TRIAL_PADRAO} dias</strong> para testar todas as funções ou selecione o plano ideal para a sua escala de eventos.
          </p>
        </div>

        <form onSubmit={handleConcluir} className="space-y-8">
          {/* 1. Dados da Agência */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-7 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <Building2 className="size-5 text-blue-600" />
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  1. Dados da Agência ou Produtora
                </h2>
                <p className="text-xs text-slate-500">
                  Identificação da sua empresa para emissão de escalas e fechamentos.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nome" className="text-xs sm:text-sm font-medium">
                  Nome da Agência / Produtora <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="nome"
                  required
                  placeholder="Ex: Prime Eventos & Produções"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cnpj" className="text-xs sm:text-sm font-medium">
                  CNPJ ou CPF do Responsável <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="cnpj"
                  required
                  placeholder="00.000.000/0000-00 ou CPF"
                  value={cnpj}
                  onChange={(e) => setCnpj(formatarCnpjOuCpf(e.target.value))}
                  className="h-11 rounded-xl"
                />
                <p className="text-[11px] text-slate-400">
                  Insira o CNPJ da agência ou CPF caso seja profissional autônomo.
                </p>
              </div>
            </div>
          </div>

          {/* 2. Seleção do Plano */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-7 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="size-5 text-blue-600" />
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    2. Escolha o Plano Inicial
                  </h2>
                  <p className="text-xs text-slate-500">
                    O plano gratuito é válido por <strong>{DIAS_TRIAL_PADRAO} dias</strong>. Após este período, você pode escolher um plano definitivo.
                  </p>
                </div>
              </div>

              <Badge variant="outline" className="self-start sm:self-auto border-emerald-500/40 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300">
                <Sparkles className="size-3 mr-1" />
                {DIAS_TRIAL_PADRAO} Dias de Teste Grátis
              </Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PLANOS_CATALOGO.map((p) => {
                const ehSelecionado = planoCodigo === p.codigo;
                const ehTrial = p.codigo === "free";

                return (
                  <div
                    key={p.codigo}
                    onClick={() => setPlanoCodigo(p.codigo)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setPlanoCodigo(p.codigo);
                      }
                    }}
                    className={cn(
                      "relative flex flex-col justify-between rounded-xl border p-4 text-left cursor-pointer transition-all outline-none",
                      ehSelecionado
                        ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500 shadow-sm"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-card",
                    )}
                  >
                    {p.badge && (
                      <span className="absolute -top-2.5 right-3 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                        {p.badge}
                      </span>
                    )}

                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base">
                          {p.nome}
                        </h3>
                        {ehSelecionado ? (
                          <div className="size-5 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0">
                            <Check className="size-3 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="size-5 rounded-full border border-slate-300 shrink-0" />
                        )}
                      </div>

                      <p className="mt-2 text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                        {ehTrial ? "R$ 0" : moeda(p.mensalidade)}
                        <span className="text-[11px] font-normal text-slate-500">
                          {ehTrial ? ` / ${DIAS_TRIAL_PADRAO} dias` : " / mês"}
                        </span>
                      </p>

                      <p className="mt-2 text-xs text-slate-500 leading-snug">
                        {p.descricao}
                      </p>

                      <div className="mt-3 rounded-lg bg-slate-100 dark:bg-slate-800/80 p-2 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {p.participacoes_incluidas} participações inclusas
                        </p>
                        <p>{moeda(p.valor_excedente)} por pessoa extra</p>
                      </div>

                      <ul className="mt-3 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                        <li className="flex items-center gap-1.5">
                          <Check className="size-3 text-emerald-600 shrink-0" />
                          <span>Ponto digital com biometria</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <Check className="size-3 text-emerald-600 shrink-0" />
                          <span>Fechamento e escalas</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <Check className="size-3 text-emerald-600 shrink-0" />
                          <span>
                            Eventos: <strong>{p.limite_eventos_ciclo ?? "Ilimitados"}</strong>
                          </span>
                        </li>
                      </ul>
                    </div>

                    {ehTrial && (
                      <div className="mt-3 rounded-md bg-emerald-50 dark:bg-emerald-950/40 p-1.5 text-[10px] text-emerald-700 dark:text-emerald-300 font-medium">
                        ✓ Sem compromisso · 7 dias completos
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Aviso sobre os 7 dias */}
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">Regra do Período de Teste:</p>
              <p className="mt-0.5">
                O plano gratuito é válido por <strong>{DIAS_TRIAL_PADRAO} dias corridos</strong> a partir do cadastro. Ao final do período, você poderá escolher um plano comercial para continuar operando, a não ser que um administrador libere mais dias de teste para a sua conta.
              </p>
            </div>
          </div>

          {/* Botão de Envio */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
            <div className="text-xs text-slate-500 text-center sm:text-left">
              Plano selecionado: <strong className="text-slate-800 dark:text-slate-200">{planoAtivo.nome}</strong>{" "}
              {planoAtivo.codigo === "free" ? "(7 dias sem cobrança)" : `(${moeda(planoAtivo.mensalidade)}/mês)`}
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={salvando}
              className="w-full sm:w-auto min-w-[240px] h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm sm:text-base shadow-sm"
            >
              {salvando ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  <span>Configurando sua agência...</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span>
                    {planoAtivo.codigo === "free"
                      ? `Iniciar teste de ${DIAS_TRIAL_PADRAO} dias grátis`
                      : "Criar agência e avançar"}
                  </span>
                  <ArrowRight className="size-4" />
                </span>
              )}
            </Button>
          </div>
        </form>
      </div>

      {/* Rodapé */}
      <footer className="mt-8 text-center text-xs text-slate-400">
        <p>Já — Gestão de Equipes, Ponto e Pagamentos por Swali</p>
      </footer>
    </div>
  );
}
