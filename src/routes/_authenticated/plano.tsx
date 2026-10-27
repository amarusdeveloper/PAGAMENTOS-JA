import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  CreditCard,
  FileText,
  HelpCircle,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AlertaAssinaturaMercadoPago } from "@/components/alerta-assinatura-mercadopago";
import { AppShell } from "@/components/app-shell";
import { LoadingBloco } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AVISO_CLT, pontoDeVirada, RECURSOS_PLANO, temRecurso } from "@/lib/cobranca-v2";
import { carregarCobranca, selecionarPlanoEmpresa } from "@/lib/cobranca.functions";
import { dataCurta, moeda } from "@/lib/dominio";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/plano")({
  head: () => ({
    meta: [
      { title: "Plano e Faturas — Já por Swali" },
      {
        name: "description",
        content:
          "Gestão de assinaturas, franquia de participações, contratação de planos e faturas da sua agência.",
      },
      { property: "og:title", content: "Plano e Faturas — Já por Swali" },
      { property: "og:description", content: "Seu ciclo, consumo e assinatura da plataforma Já." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaginaPlano,
});

function PaginaPlano() {
  const queryClient = useQueryClient();
  const carregarFn = useServerFn(carregarCobranca);
  const selecionarPlanoFn = useServerFn(selecionarPlanoEmpresa);

  const [planoSelecionado, setPlanoSelecionado] = useState<{
    id: string;
    nome: string;
    mensalidade: number;
    participacoes: number;
  } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["cobranca-v2"],
    queryFn: () => carregarFn(),
    staleTime: 30_000,
  });

  const trocarPlano = useMutation({
    mutationFn: (planoId: string) => selecionarPlanoFn({ data: { planoId } }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-v2"] });
      queryClient.invalidateQueries({ queryKey: ["painel"] });
      queryClient.invalidateQueries({ queryKey: ["assinatura-mercadopago-status"] });
      setPlanoSelecionado(null);
      toast.success(`Plano alterado para ${res.planoNome} com sucesso!`);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Não foi possível alterar o plano.");
    },
  });

  if (isLoading) {
    return (
      <AppShell titulo="Plano e faturas" descricao="Carregando dados da sua assinatura...">
        <LoadingBloco />
      </AppShell>
    );
  }

  if (isError || !data) {
    return (
      <AppShell titulo="Plano e faturas" descricao="Gerenciamento de planos da plataforma">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4">
          <AlertCircle className="mx-auto size-8 text-destructive" />
          <div>
            <h2 className="text-base font-semibold">Falha ao carregar informações de cobrança</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Houve uma instabilidade momentânea na consulta da sua assinatura.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      </AppShell>
    );
  }

  const { uso, ciclo, estimativa, planos, faturas, taxas } = data;
  const planoAtualId = ciclo?.plano_id;

  return (
    <AppShell
      titulo="Plano e faturas"
      descricao={`${uso?.plano_nome ?? "Plano"} · Ciclo vigente de ${dataCurta(ciclo?.inicio)} até ${dataCurta(ciclo?.fim)}`}
    >
      <AlertaAssinaturaMercadoPago />

      {/* 1. Indicadores de Consumo do Ciclo Atual */}
      <section className="mb-8 rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Consumo no Ciclo Atual
        </h2>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-muted/40 p-4 border border-border/60">
            <dt className="text-xs font-medium text-muted-foreground">
              Participações operacionais
            </dt>
            <dd className="mt-2 text-2xl sm:text-3xl font-extrabold text-foreground">
              {uso?.participacoes_usadas ?? 0}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {ciclo?.participacoes_incluidas ?? 0} incluídas
              </span>
            </dd>
          </div>

          <div className="rounded-xl bg-muted/40 p-4 border border-border/60">
            <dt className="text-xs font-medium text-muted-foreground">
              Excedentes ({moeda(ciclo?.valor_excedente ?? 0)} cada)
            </dt>
            <dd className="mt-2 text-2xl sm:text-3xl font-extrabold text-foreground">
              {estimativa?.excedentes ?? 0}
              <span className="text-xs font-normal text-muted-foreground block mt-0.5">
                Total: {moeda(estimativa?.valorExcedente ?? 0)}
              </span>
            </dd>
          </div>

          <div className="rounded-xl bg-muted/40 p-4 border border-border/60">
            <dt className="text-xs font-medium text-muted-foreground">Estimativa SaaS do ciclo</dt>
            <dd className="mt-2 text-2xl sm:text-3xl font-extrabold text-primary">
              {moeda(estimativa?.total ?? 0)}
              <span className="text-xs font-normal text-muted-foreground block mt-0.5">
                Mensalidade: {moeda(ciclo?.mensalidade ?? 0)}
              </span>
            </dd>
          </div>

          <div className="rounded-xl bg-muted/40 p-4 border border-border/60">
            <dt className="text-xs font-medium text-muted-foreground">CLT ativos na agência</dt>
            <dd className="mt-2 text-2xl sm:text-3xl font-extrabold text-foreground">
              {uso?.clt_ativos ?? 0}
              <span className="text-xs font-normal text-muted-foreground block mt-0.5">
                Limite: {uso?.limite_clt ?? "Sem limite"}
              </span>
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground border-t border-border/60 pt-4">
          <div className="flex flex-wrap gap-4">
            <span>
              Eventos no ciclo: <strong>{uso?.eventos_usados ?? 0}</strong> /{" "}
              {uso?.limite_eventos ?? "Ilimitado"}
            </span>
            <span>
              Pessoas por evento: <strong>{uso?.limite_pessoas_evento ?? "Sem limite"}</strong>
            </span>
            <span>
              Supervisores autorizados: <strong>{uso?.limite_supervisores ?? "Sem limite"}</strong>
            </span>
          </div>
          <span className="italic">{AVISO_CLT}</span>
        </div>
      </section>

      {/* 2. Catálogo de Planos com Ação de Contratação */}
      <section className="mb-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
          <div>
            <h2 className="text-xl font-bold text-foreground">Planos Disponíveis</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Escolha o pacote ideal para o volume de eventos e colaboradores da sua agência.
            </p>
          </div>
          <Badge
            variant="outline"
            className="self-start sm:self-auto border-blue-500/40 text-blue-600 dark:text-blue-400"
          >
            Billing V2 · Sem comissão sobre repasses
          </Badge>
        </div>

        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {planos.map((p, index) => {
            const proximo = planos[index + 1];
            const virada = proximo && p.codigo !== "free" ? pontoDeVirada(p, proximo) : null;
            const ehPlanoAtual =
              p.id === planoAtualId ||
              p.nome.toLowerCase() === (uso?.plano_nome ?? "").toLowerCase();

            return (
              <article
                key={p.id}
                className={cn(
                  "relative flex flex-col justify-between rounded-2xl border p-5 sm:p-6 transition-all",
                  ehPlanoAtual
                    ? "border-blue-600 bg-blue-50/40 dark:bg-blue-950/20 shadow-md ring-2 ring-blue-500/30"
                    : "border-border/80 bg-card hover:border-blue-300 hover:shadow-sm",
                )}
              >
                {ehPlanoAtual && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-0.5 text-[11px] font-bold text-white shadow-xs">
                    Plano Atual
                  </span>
                )}

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold text-base sm:text-lg text-foreground">{p.nome}</h3>
                    {p.codigo === "free" && (
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Gratuito
                      </span>
                    )}
                  </div>

                  <p className="mt-3 text-2xl sm:text-3xl font-extrabold text-foreground">
                    {moeda(p.mensalidade)}
                    <span className="text-xs font-normal text-muted-foreground"> / mês</span>
                  </p>

                  <div className="mt-3 rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">
                      {p.participacoes_incluidas} participações inclusas
                    </p>
                    <p>{moeda(p.valor_excedente)} por participação extra</p>
                  </div>

                  <ul className="mt-4 space-y-2 text-xs">
                    <li className="flex items-center gap-2 text-muted-foreground">
                      <Check className="size-3.5 text-emerald-600 shrink-0" />
                      <span>
                        CLT: <strong>{p.limite_clt ?? "Sem limite"}</strong>
                      </span>
                    </li>
                    <li className="flex items-center gap-2 text-muted-foreground">
                      <Check className="size-3.5 text-emerald-600 shrink-0" />
                      <span>
                        Supervisores: <strong>{p.limite_supervisores ?? "Sem limite"}</strong>
                      </span>
                    </li>
                    {RECURSOS_PLANO.filter((r) => temRecurso(p.recursos, r.chave)).map((r) => (
                      <li
                        key={r.chave}
                        className="flex items-center gap-2 text-foreground font-medium"
                      >
                        <Check className="size-3.5 text-blue-600 shrink-0" />
                        <span>{r.rotulo}</span>
                      </li>
                    ))}
                  </ul>

                  {virada ? (
                    <div className="mt-4 rounded-lg bg-blue-50 dark:bg-blue-950/40 p-2 text-[11px] text-blue-800 dark:text-blue-300">
                      Compensa mudar para <strong>{proximo?.nome}</strong> a partir de {virada}{" "}
                      participações.
                    </div>
                  ) : null}
                </div>

                <div className="mt-6 pt-4 border-t border-border/60">
                  {ehPlanoAtual ? (
                    <Button
                      disabled
                      variant="outline"
                      className="w-full h-11 rounded-xl text-xs font-bold text-muted-foreground"
                    >
                      <CheckCircle2 className="size-4 mr-1.5 text-emerald-600" />
                      Seu plano ativo
                    </Button>
                  ) : (
                    <Button
                      className="w-full h-11 rounded-xl font-semibold text-xs sm:text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                      onClick={() =>
                        setPlanoSelecionado({
                          id: p.id,
                          nome: p.nome,
                          mensalidade: p.mensalidade,
                          participacoes: p.participacoes_incluidas,
                        })
                      }
                    >
                      Escolher este plano
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* 3. Tabela de Faturas SaaS */}
      <section className="mb-10 rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-foreground">
              Faturas e Mensalidades
            </h2>
            <p className="text-xs text-muted-foreground">
              Histórico de fechamentos de ciclos SaaS e comprovantes de liquidação.
            </p>
          </div>
          <FileText className="size-5 text-muted-foreground" />
        </div>

        {faturas.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Ciclo</TableHead>
                  <TableHead className="text-xs">Participações</TableHead>
                  <TableHead className="text-xs">Valor Total</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Vencimento</TableHead>
                  <TableHead className="text-xs text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {faturas.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-xs font-medium">
                      {dataCurta(f.ciclo_inicio)}
                    </TableCell>
                    <TableCell className="text-xs">{f.participacoes_usadas}</TableCell>
                    <TableCell className="text-xs font-bold">{moeda(f.total)}</TableCell>
                    <TableCell className="text-xs">
                      <Badge
                        variant="outline"
                        className={cn(
                          "capitalize text-[11px]",
                          f.status === "pago"
                            ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                        )}
                      >
                        {f.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {dataCurta(f.vencimento)}
                    </TableCell>
                    <TableCell className="text-xs text-right">
                      {f.status !== "pago" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs font-semibold text-blue-600 hover:text-blue-700"
                          onClick={() => {
                            toast.info(
                              "A cobrança está aberta no gateway Asaas/Mercado Pago. Utilize a chave Pix ou boleto da agência.",
                            );
                          }}
                        >
                          <CreditCard className="size-3.5 mr-1" />
                          Pagar
                        </Button>
                      ) : (
                        <span className="text-[11px] text-emerald-600 font-semibold">Quitado</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="rounded-xl bg-muted/30 p-8 text-center text-xs text-muted-foreground border border-dashed border-border">
            <CheckCircle2 className="mx-auto size-6 text-muted-foreground/60 mb-2" />
            <p className="font-semibold text-foreground">Nenhuma fatura pendente</p>
            <p className="mt-1">
              As faturas são geradas ao término de cada ciclo mensal de 30 dias com base no uso.
            </p>
          </div>
        )}
      </section>

      {/* 4. Custos e Tarifas do Meio de Pagamento */}
      {taxas.length > 0 && (
        <section className="rounded-2xl border border-border/80 bg-muted/20 p-5 text-xs text-muted-foreground">
          <h3 className="font-bold text-foreground text-sm mb-2">Custos do Meio de Pagamento</h3>
          <ul className="flex flex-wrap gap-4">
            {taxas.map((t) => (
              <li key={t.id} className="rounded-lg bg-card px-3 py-1.5 border border-border/60">
                <span className="font-medium text-foreground">{t.rotulo}:</span>{" "}
                {(t.taxa * 100).toFixed(2)}%
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px]">
            * Valores de repasses a trabalhadores e custos de gateways financeiros não compõem a
            receita do software Já.
          </p>
        </section>
      )}

      {/* Modal de Confirmação de Troca de Plano */}
      <Dialog
        open={Boolean(planoSelecionado)}
        onOpenChange={(aberto) => !aberto && setPlanoSelecionado(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar alteração de plano</DialogTitle>
            <DialogDescription>
              Você está contratando o plano <strong>{planoSelecionado?.nome}</strong> para sua
              agência.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl bg-muted/50 p-4 border border-border space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mensalidade do novo plano:</span>
              <strong className="text-foreground text-sm">
                {moeda(planoSelecionado?.mensalidade ?? 0)}/mês
              </strong>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Franquia de participações:</span>
              <strong className="text-foreground">
                {planoSelecionado?.participacoes ?? 0} no ciclo
              </strong>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setPlanoSelecionado(null)}
              disabled={trocarPlano.isPending}
            >
              Cancelar
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              disabled={trocarPlano.isPending}
              onClick={() => {
                if (planoSelecionado) {
                  trocarPlano.mutate(planoSelecionado.id);
                }
              }}
            >
              {trocarPlano.isPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-4 animate-spin" />
                  <span>Atualizando...</span>
                </span>
              ) : (
                <span>Confirmar contratação</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
