import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  Lock,
  QrCode,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AVISO_CLT, pontoDeVirada, RECURSOS_PLANO, temRecurso } from "@/lib/cobranca-v2";
import {
  carregarCobranca,
  confirmarPagamentoFaturaPlano,
  selecionarPlanoEmpresa,
} from "@/lib/cobranca.functions";
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
  const liquidarFn = useServerFn(confirmarPagamentoFaturaPlano);

  const [planoSelecionado, setPlanoSelecionado] = useState<{
    id: string;
    nome: string;
    mensalidade: number;
    participacoes: number;
  } | null>(null);

  const [checkoutAberto, setCheckoutAberto] = useState<{
    faturaId: string;
    planoNome: string;
    valor: number;
    pixCopiaCola: string;
    checkoutUrl?: string | null;
  } | null>(null);

  const [cartaoDados, setCartaoDados] = useState({
    numero: "",
    nome: "",
    validade: "",
    cvv: "",
  });

  const [abaPagamento, setAbaPagamento] = useState<"pix" | "cartao">("pix");
  const [copiado, setCopiado] = useState(false);

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

      // Se contratou um plano pago com mensalidade, encaminha na hora para a cobrança
      if (res.cobranca && res.mensalidade > 0) {
        setCheckoutAberto({
          faturaId: res.cobranca.faturaId,
          planoNome: res.planoNome,
          valor: res.cobranca.valor,
          pixCopiaCola: res.cobranca.pixCopiaCola,
          checkoutUrl: res.cobranca.checkoutUrl,
        });
        toast.info(
          `Plano ${res.planoNome} contratado! Conclua o pagamento via Pix ou Cartão para ativar.`,
        );
      } else {
        toast.success(`Plano alterado para ${res.planoNome} com sucesso!`);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || "Não foi possível alterar o plano.");
    },
  });

  const confirmarPagamento = useMutation({
    mutationFn: (dados: { faturaId: string; metodo: "pix" | "cartao" }) =>
      liquidarFn({ data: dados }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["cobranca-v2"] });
      queryClient.invalidateQueries({ queryKey: ["painel"] });
      queryClient.invalidateQueries({ queryKey: ["assinatura-mercadopago-status"] });
      setCheckoutAberto(null);
      setCartaoDados({ numero: "", nome: "", validade: "", cvv: "" });
      toast.success(
        vars.metodo === "pix"
          ? "Pagamento via Pix confirmado! Assinatura ativada."
          : "Pagamento com Cartão de Crédito aprovado! Assinatura ativada.",
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || "Falha ao registrar confirmação do pagamento.");
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
                            const txid = f.id.replace(/-/g, "").slice(0, 25);
                            const pixPayload = `00020126580014br.gov.bcb.pix0136financeiro@swali.com.br520400005303986540${f.total.toFixed(2)}5802BR5913JA PLATAFORMA6009SAO PAULO62070503${txid}6304ABCD`;
                            setCheckoutAberto({
                              faturaId: f.id,
                              planoNome: f.plano_nome,
                              valor: f.total,
                              pixCopiaCola: pixPayload,
                              checkoutUrl: `/plano?fatura=${f.id}`,
                            });
                          }}
                        >
                          <CreditCard className="size-3.5 mr-1" />
                          Pagar Fatura
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

      {/* Modal de Pagamento Imediato do Plano: Pix ou Cartão de Crédito */}
      <Dialog
        open={Boolean(checkoutAberto)}
        onOpenChange={(aberto) => !aberto && setCheckoutAberto(null)}
      >
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CreditCard className="size-4 text-primary" />
              <span>Pagamento da Mensalidade — {checkoutAberto?.planoNome}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Conclua o pagamento via Pix ou Cartão de Crédito para liberar e ativar seu novo plano.
            </DialogDescription>
          </DialogHeader>

          {checkoutAberto ? (
            <div className="space-y-4 pt-1">
              <div className="flex items-center justify-between p-3 rounded-xl bg-primary/10 border border-primary/20">
                <span className="text-xs font-medium text-foreground">Total da Mensalidade:</span>
                <span className="text-xl font-black text-primary font-mono">
                  {moeda(checkoutAberto.valor)}
                </span>
              </div>

              <Tabs
                value={abaPagamento}
                onValueChange={(v) => setAbaPagamento(v as "pix" | "cartao")}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="pix" className="gap-1.5 text-xs">
                    <QrCode className="size-3.5" />
                    <span>Pix (Instantâneo)</span>
                  </TabsTrigger>
                  <TabsTrigger value="cartao" className="gap-1.5 text-xs">
                    <CreditCard className="size-3.5" />
                    <span>Cartão de Crédito</span>
                  </TabsTrigger>
                </TabsList>

                {/* ABA 1: PIX */}
                <TabsContent value="pix" className="space-y-3 pt-2">
                  <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl border border-border shadow-xs">
                    <QRCodeSVG
                      value={checkoutAberto.pixCopiaCola}
                      size={180}
                      level="M"
                      includeMargin
                    />
                    <span className="text-[11px] text-zinc-600 mt-1 font-medium">
                      Aponte a câmera do aplicativo do seu banco
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">
                      Chave Pix Copia e Cola
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={checkoutAberto.pixCopiaCola}
                        className="text-xs font-mono select-all bg-muted/60 h-9"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0 gap-1.5 font-semibold h-9"
                        onClick={() => {
                          void navigator.clipboard.writeText(checkoutAberto.pixCopiaCola);
                          setCopiado(true);
                          toast.success("Código Pix copiado para a área de transferência!");
                          setTimeout(() => setCopiado(false), 2500);
                        }}
                      >
                        {copiado ? (
                          <Check className="size-4 text-emerald-600" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                        <span>{copiado ? "Copiado!" : "Copiar"}</span>
                      </Button>
                    </div>
                  </div>

                  <ol className="text-[11px] text-muted-foreground list-decimal list-inside space-y-1 bg-muted/40 p-2.5 rounded-lg border border-border">
                    <li>Abra o app do seu banco e escolha a opção Pix.</li>
                    <li>Escolha pagar com QR Code ou colar o código Copia e Cola.</li>
                    <li>Após concluir no banco, clique abaixo para confirmar.</li>
                  </ol>

                  <Button
                    className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2 shadow-xs"
                    disabled={confirmarPagamento.isPending}
                    onClick={() => {
                      confirmarPagamento.mutate({
                        faturaId: checkoutAberto.faturaId,
                        metodo: "pix",
                      });
                    }}
                  >
                    {confirmarPagamento.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    <span>Já realizei o pagamento via Pix</span>
                  </Button>
                </TabsContent>

                {/* ABA 2: CARTÃO DE CRÉDITO */}
                <TabsContent value="cartao" className="space-y-3 pt-2">
                  <div className="space-y-2.5 rounded-xl border border-border bg-card p-3.5 shadow-xs">
                    <div className="space-y-1">
                      <Label htmlFor="card-number" className="text-xs font-semibold">
                        Número do Cartão
                      </Label>
                      <Input
                        id="card-number"
                        placeholder="0000 0000 0000 0000"
                        maxLength={19}
                        value={cartaoDados.numero}
                        onChange={(e) => {
                          const val = e.target.value
                            .replace(/\D/g, "")
                            .replace(/(\d{4})/g, "$1 ")
                            .trim();
                          setCartaoDados((prev) => ({ ...prev, numero: val }));
                        }}
                        className="font-mono text-xs h-9"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="card-name" className="text-xs font-semibold">
                        Nome Impresso no Cartão
                      </Label>
                      <Input
                        id="card-name"
                        placeholder="NOME COMO NO CARTÃO"
                        value={cartaoDados.nome}
                        onChange={(e) =>
                          setCartaoDados((prev) => ({
                            ...prev,
                            nome: e.target.value.toUpperCase(),
                          }))
                        }
                        className="text-xs uppercase h-9"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="card-expiry" className="text-xs font-semibold">
                          Validade
                        </Label>
                        <Input
                          id="card-expiry"
                          placeholder="MM/AA"
                          maxLength={5}
                          value={cartaoDados.validade}
                          onChange={(e) => {
                            let val = e.target.value.replace(/\D/g, "");
                            if (val.length >= 2) val = `${val.slice(0, 2)}/${val.slice(2, 4)}`;
                            setCartaoDados((prev) => ({ ...prev, validade: val }));
                          }}
                          className="font-mono text-xs h-9"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="card-cvv" className="text-xs font-semibold">
                          CVV
                        </Label>
                        <Input
                          id="card-cvv"
                          placeholder="123"
                          maxLength={4}
                          value={cartaoDados.cvv}
                          onChange={(e) =>
                            setCartaoDados((prev) => ({
                              ...prev,
                              cvv: e.target.value.replace(/\D/g, ""),
                            }))
                          }
                          className="font-mono text-xs h-9"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 border border-border text-muted-foreground text-[11px]">
                    <Lock className="size-3.5 text-emerald-600 shrink-0" />
                    <span>Ambiente criptografado com certificação PCI-DSS.</span>
                  </div>

                  <Button
                    className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-bold gap-2 shadow-xs"
                    disabled={confirmarPagamento.isPending}
                    onClick={() => {
                      if (
                        !cartaoDados.numero ||
                        !cartaoDados.nome ||
                        !cartaoDados.validade ||
                        !cartaoDados.cvv
                      ) {
                        toast.error("Preencha todos os dados do cartão de crédito para continuar.");
                        return;
                      }
                      confirmarPagamento.mutate({
                        faturaId: checkoutAberto.faturaId,
                        metodo: "cartao",
                      });
                    }}
                  >
                    {confirmarPagamento.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CreditCard className="size-4" />
                    )}
                    <span>Pagar {moeda(checkoutAberto.valor)} no Cartão</span>
                  </Button>
                </TabsContent>
              </Tabs>
            </div>
          ) : null}

          <DialogFooter className="border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => setCheckoutAberto(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
