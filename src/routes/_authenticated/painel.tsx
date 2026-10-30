import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  FileCheck2,
  MapPin,
  Plus,
  Radio,
  ShieldAlert,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { AlertaAssinaturaMercadoPago } from "@/components/alerta-assinatura-mercadopago";
import { EmptyState, ErrorState, LoadingBloco } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useSessao } from "@/hooks/use-sessao";
import { supabase } from "@/integrations/supabase/client";
import { carregarCobranca } from "@/lib/cobranca.functions";
import { dataHora, moeda, ROTULO_PAPEL } from "@/lib/dominio";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Painel Operacional — Já" },
      {
        name: "description",
        content:
          "Visão operacional e financeira em tempo real da plataforma Já: eventos em campo, escalas, presenças e pagamentos.",
      },
      { property: "og:title", content: "Painel Operacional — Já" },
      {
        property: "og:description",
        content:
          "Acompanhamento da operação: eventos, escalas, aprovação de ponto, fechamentos e saldo de repasses.",
      },
    ],
  }),
  component: Painel,
});

async function carregarDadosPainel(empresaId: string) {
  const emTresDias = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
  const agoraIso = new Date().toISOString();

  const [
    eventosRes,
    escalasConfirmadasRes,
    colaboradoresAtivosRes,
    pontosRes,
    fechamentosRes,
    pagamentosRes,
    saldoRes,
  ] = await Promise.all([
    // 1. Eventos ativos da empresa ordenados cronologicamente
    supabase
      .from("eventos")
      .select("id, nome, local, data_inicio, data_fim, status, qr_code_token")
      .eq("empresa_id", empresaId)
      .not("status", "in", "(concluido,arquivado,cancelado)")
      .order("data_inicio", { ascending: true })
      .limit(10),

    // 2. Total de escalas confirmadas
    supabase
      .from("escalas")
      .select("id, equipes!inner(eventos!inner(empresa_id))", {
        count: "exact",
        head: true,
      })
      .eq("status", "confirmado")
      .eq("equipes.eventos.empresa_id", empresaId),

    // 3. Colaboradores ativos cadastrados
    supabase
      .from("freelancers")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("ativo", true),

    // 4. Pontos pendentes de validação
    supabase
      .from("pontos")
      .select("id, escalas!inner(equipes!inner(eventos!inner(empresa_id)))", {
        count: "exact",
        head: true,
      })
      .eq("status", "pendente")
      .eq("escalas.equipes.eventos.empresa_id", empresaId),

    // 5. Fechamentos aguardando aprovação
    supabase
      .from("fechamentos")
      .select("id, escalas!inner(equipes!inner(eventos!inner(empresa_id)))", {
        count: "exact",
        head: true,
      })
      .eq("escalas.equipes.eventos.empresa_id", empresaId)
      .eq("status", "pendente_aprovacao"),

    // 6. Pagamentos da empresa
    supabase
      .from("pagamentos")
      .select(
        "valor, status, fechamentos!inner(escalas!inner(equipes!inner(eventos!inner(empresa_id))))",
      )
      .eq("fechamentos.escalas.equipes.eventos.empresa_id", empresaId),

    // 7. Saldo real disponível em conta
    supabase.rpc("saldo_empresa", { _empresa_id: empresaId }),
  ]);

  let pontosForaHorario = 0;
  try {
    const { count } = await supabase
      .from("pontos")
      .select("id, escalas!inner(equipes!inner(eventos!inner(empresa_id)))", {
        count: "exact",
        head: true,
      })
      .eq("status", "pendente")
      .eq("fora_horario", true)
      .eq("escalas.equipes.eventos.empresa_id", empresaId);
    pontosForaHorario = count ?? 0;
  } catch {
    pontosForaHorario = 0;
  }

  let selfiesExpirando = 0;
  try {
    const { count } = await supabase
      .from("pontos")
      .select("id, escalas!inner(equipes!inner(eventos!inner(empresa_id)))", {
        count: "exact",
        head: true,
      })
      .not("foto_url", "is", null)
      .lte("selfie_expira_em", emTresDias)
      .gte("selfie_expira_em", agoraIso)
      .eq("escalas.equipes.eventos.empresa_id", empresaId);
    selfiesExpirando = count ?? 0;
  } catch {
    selfiesExpirando = 0;
  }

  const pagamentosLista = Array.isArray(pagamentosRes.data) ? pagamentosRes.data : [];
  const aPagar = pagamentosLista
    .filter((p) => p.status === "pendente" || p.status === "agendado")
    .reduce((s, p) => s + Number(p.valor || 0), 0);
  const pago = pagamentosLista
    .filter((p) => p.status === "executado")
    .reduce((s, p) => s + Number(p.valor || 0), 0);
  const pagamentosFalhos = pagamentosLista.filter((p) => p.status === "falhou").length;

  return {
    eventos: Array.isArray(eventosRes.data) ? eventosRes.data : [],
    escalasConfirmadas: escalasConfirmadasRes.count ?? 0,
    colaboradoresAtivos: colaboradoresAtivosRes.count ?? 0,
    pontosPendentes: pontosRes.count ?? 0,
    pontosForaHorario,
    selfiesExpirando,
    fechamentosPendentes: fechamentosRes.count ?? 0,
    aPagar,
    pago,
    pagamentosFalhos,
    saldoReal: Number(saldoRes?.data ?? 0),
  };
}

function Painel() {
  const { sessao, pode, empresaId } = useSessao();
  const [filtroEventos, setFiltroEventos] = useState<"todos" | "aovivo" | "proximos">("todos");

  const q = useQuery({
    queryKey: ["painel", empresaId],
    enabled: Boolean(empresaId),
    queryFn: () => {
      if (!empresaId) throw new Error("Organização não identificada.");
      return carregarDadosPainel(empresaId);
    },
    refetchInterval: 30_000,
  });

  const carregarCobrancaFn = useServerFn(carregarCobranca);

  const cobranca = useQuery({
    queryKey: ["cobranca-v2", empresaId],
    enabled: Boolean(empresaId),
    queryFn: () => carregarCobrancaFn(),
    refetchInterval: 30_000,
  });

  const eventos = useMemo(() => q.data?.eventos ?? [], [q.data?.eventos]);
  const eventosAoVivo = useMemo(
    () =>
      eventos.filter(
        (e) => e.status === "em_execucao" || e.status === "pronto" || e.status === "encerrando",
      ),
    [eventos],
  );

  const eventosFiltrados = useMemo(() => {
    if (filtroEventos === "aovivo") return eventosAoVivo;
    if (filtroEventos === "proximos")
      return eventos.filter((e) => !["em_execucao", "pronto", "encerrando"].includes(e.status));
    return eventos;
  }, [eventos, eventosAoVivo, filtroEventos]);

  const totalPendencias =
    (q.data?.pontosPendentes ?? 0) +
    (q.data?.fechamentosPendentes ?? 0) +
    (q.data?.pontosForaHorario ?? 0) +
    (q.data?.pagamentosFalhos ?? 0);

  const saldoLiquido = (q.data?.saldoReal ?? 0) - (q.data?.aPagar ?? 0);
  const saldoDeficitario = saldoLiquido < 0 && (q.data?.aPagar ?? 0) > 0;

  return (
    <AppShell titulo="Painel" descricao="Acompanhamento operacional e financeiro da agência">
      <AlertaAssinaturaMercadoPago />
      {/* Mobile App Header & Quick Action Bar (Mobile Only) */}
      <div className="sm:hidden mb-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {sessao?.papeis && sessao.papeis.length > 0
                ? ROTULO_PAPEL[sessao.papeis[0]!]
                : "Organização"}
            </p>
            <h1 className="text-lg font-bold text-foreground tracking-tight truncate">
              {sessao?.empresa?.nome ?? "Já Gestão"}
            </h1>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold shrink-0">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            Em operação
          </div>
        </div>

        {/* Quick Action Carousel */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 -mx-4 px-4">
          {pode("eventos.gerenciar") ? (
            <Link
              to="/eventos"
              className="flex items-center gap-1.5 shrink-0 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-xs shadow-xs active:scale-95 transition-transform"
            >
              <Plus className="size-3.5" />
              Novo evento
            </Link>
          ) : null}
          <Link
            to="/operacao"
            className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl bg-card border border-border text-foreground font-medium text-xs shadow-2xs active:scale-95 transition-transform"
          >
            <Radio className="size-3.5 text-primary" />
            Ponto Digital
            {(q.data?.pontosPendentes ?? 0) > 0 ? (
              <span className="size-2 rounded-full bg-amber-500" />
            ) : null}
          </Link>
          <Link
            to="/freelancers"
            className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl bg-card border border-border text-foreground font-medium text-xs shadow-2xs active:scale-95 transition-transform"
          >
            <Users className="size-3.5 text-indigo-500" />
            Equipes
          </Link>
          <Link
            to="/saldo"
            className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl bg-card border border-border text-foreground font-medium text-xs shadow-2xs active:scale-95 transition-transform"
          >
            <Wallet className="size-3.5 text-emerald-500" />
            Saldo Pix
          </Link>
          <Link
            to="/fechamento"
            className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl bg-card border border-border text-foreground font-medium text-xs shadow-2xs active:scale-95 transition-transform"
          >
            <FileCheck2 className="size-3.5 text-sky-500" />
            Fechamentos
          </Link>
          {cobranca.data && pode("configuracoes.gerenciar") ? (
            <Link
              to="/plano"
              className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl bg-card border border-border text-foreground font-medium text-xs shadow-2xs active:scale-95 transition-transform"
            >
              <CreditCard className="size-3.5 text-purple-500" />
              Meu plano
            </Link>
          ) : null}
        </div>
      </div>

      {/* 1. Barra de Contexto Superior Factual (Desktop / Tablet) */}
      <div className="hidden sm:flex mb-6 flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {sessao?.empresa?.nome ?? "Organização"}
          </span>
          {sessao?.papeis && sessao.papeis.length > 0 ? (
            <>
              <span aria-hidden="true" className="text-border">
                ·
              </span>
              <span>{ROTULO_PAPEL[sessao.papeis[0]!]}</span>
            </>
          ) : null}
          {cobranca.data?.uso ? (
            <>
              <span aria-hidden="true" className="text-border">
                ·
              </span>
              <span>
                {cobranca.data.uso.plano_codigo === "free"
                  ? `Plano ${cobranca.data.uso.plano_nome ?? "Gratuito"} (${cobranca.data.uso.eventos_usados ?? 0}/${cobranca.data.uso.limite_eventos ?? 1} eventos)`
                  : `Plano ${cobranca.data.uso.plano_nome ?? "Pro"} (${cobranca.data.uso.participacoes_usadas ?? 0} participações)`}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {cobranca.data && pode("configuracoes.gerenciar") ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
            >
              <Link to="/plano">Plano e faturas</Link>
            </Button>
          ) : null}
          {pode("eventos.gerenciar") ? (
            <Button asChild size="sm" className="h-8 text-xs gap-1.5 font-medium shadow-2xs">
              <Link to="/eventos">
                <Plus className="size-3.5" /> Novo evento
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {q.isPending ? (
        <LoadingBloco linhas={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          {/* 2. Mobile Native App Indicators (Mobile Only) */}
          <section
            aria-label="Indicadores da agência"
            className="grid grid-cols-2 gap-2.5 sm:hidden"
          >
            {/* Eventos */}
            <Link
              to="/eventos"
              className="p-3.5 rounded-2xl border border-border bg-card shadow-2xs active:scale-[0.98] transition-transform space-y-2 block"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Eventos
                </span>
                <span className="size-7 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <CalendarDays className="size-3.5" />
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {q.data.eventos.length}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {eventosAoVivo.length > 0 ? `${eventosAoVivo.length} em campo` : "Ativos"}
                </p>
              </div>
            </Link>

            {/* Escalas */}
            <Link
              to="/freelancers"
              className="p-3.5 rounded-2xl border border-border bg-card shadow-2xs active:scale-[0.98] transition-transform space-y-2 block"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Escalas
                </span>
                <span className="size-7 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Users className="size-3.5" />
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {q.data.escalasConfirmadas}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {q.data.colaboradoresAtivos} colaboradores
                </p>
              </div>
            </Link>

            {/* Pontos a Revisar */}
            <Link
              to="/operacao"
              className={cn(
                "p-3.5 rounded-2xl border bg-card shadow-2xs active:scale-[0.98] transition-transform space-y-2 block",
                q.data.pontosPendentes > 0
                  ? "border-amber-500/40 bg-amber-500/[0.03]"
                  : "border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Ponto
                </span>
                <span
                  className={cn(
                    "size-7 rounded-xl flex items-center justify-center",
                    q.data.pontosPendentes > 0
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Clock className="size-3.5" />
                </span>
              </div>
              <div>
                <p
                  className={cn(
                    "text-2xl font-bold tracking-tight tabular-nums",
                    q.data.pontosPendentes > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-foreground",
                  )}
                >
                  {q.data.pontosPendentes}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {q.data.pontosPendentes > 0 ? "Aprovação pendente" : "Tudo conferido"}
                </p>
              </div>
            </Link>

            {/* Fechamentos */}
            <Link
              to="/fechamento"
              className={cn(
                "p-3.5 rounded-2xl border bg-card shadow-2xs active:scale-[0.98] transition-transform space-y-2 block",
                q.data.fechamentosPendentes > 0
                  ? "border-sky-500/40 bg-sky-500/[0.03]"
                  : "border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Fechamento
                </span>
                <span className="size-7 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                  <FileCheck2 className="size-3.5" />
                </span>
              </div>
              <div>
                <p
                  className={cn(
                    "text-2xl font-bold tracking-tight tabular-nums",
                    q.data.fechamentosPendentes > 0
                      ? "text-sky-600 dark:text-sky-400"
                      : "text-foreground",
                  )}
                >
                  {q.data.fechamentosPendentes}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {q.data.fechamentosPendentes > 0 ? "A conferir" : "Sem pendências"}
                </p>
              </div>
            </Link>

            {/* Saldo Disponível */}
            <Link
              to="/saldo"
              className="p-3.5 rounded-2xl border border-border bg-card shadow-2xs active:scale-[0.98] transition-transform space-y-2 block"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Saldo Pix
                </span>
                <span className="size-7 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Wallet className="size-3.5" />
                </span>
              </div>
              <div>
                <p className="text-xl font-bold tracking-tight text-foreground tabular-nums truncate">
                  {moeda(q.data.saldoReal)}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">Conta da agência</p>
              </div>
            </Link>

            {/* A Transferir */}
            <Link
              to="/financeiro"
              className={cn(
                "p-3.5 rounded-2xl border bg-card shadow-2xs active:scale-[0.98] transition-transform space-y-2 block",
                saldoDeficitario ? "border-rose-500/40 bg-rose-500/[0.03]" : "border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Repasses
                </span>
                <span
                  className={cn(
                    "size-7 rounded-xl flex items-center justify-center",
                    saldoDeficitario
                      ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <CreditCard className="size-3.5" />
                </span>
              </div>
              <div>
                <p
                  className={cn(
                    "text-xl font-bold tracking-tight tabular-nums truncate",
                    saldoDeficitario ? "text-rose-600 dark:text-rose-400" : "text-foreground",
                  )}
                >
                  {moeda(q.data.aPagar)}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {saldoDeficitario ? "Aporte requerido" : `Pago: ${moeda(q.data.pago)}`}
                </p>
              </div>
            </Link>
          </section>

          {/* 2b. Indicadores Clássicos para Desktop / Tablet */}
          <section
            aria-label="Indicadores principais"
            className="hidden sm:grid grid-cols-3 divide-y divide-border border border-border bg-card sm:divide-y-0 sm:divide-x lg:grid-cols-6 rounded-lg shadow-2xs"
          >
            {/* Eventos */}
            <Link
              to="/eventos"
              className="group p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground group-hover:text-foreground">
                Eventos ativos
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground tabular-nums">
                {q.data.eventos.length}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {eventosAoVivo.length > 0
                  ? `${eventosAoVivo.length} em campo agora`
                  : "Programação ativa"}
              </p>
            </Link>

            {/* Escalas */}
            <Link
              to="/freelancers"
              className="group p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground group-hover:text-foreground">
                Escalas ativas
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground tabular-nums">
                {q.data.escalasConfirmadas}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                de {q.data.colaboradoresAtivos} colaboradores
              </p>
            </Link>

            {/* Pontos a Aprovar */}
            <Link
              to="/operacao"
              className="group p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground group-hover:text-foreground">
                Pontos a revisar
              </p>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <p
                  className={cn(
                    "text-2xl font-bold tracking-tight tabular-nums",
                    q.data.pontosPendentes > 0 ? "text-primary" : "text-foreground",
                  )}
                >
                  {q.data.pontosPendentes}
                </p>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                {q.data.pontosForaHorario > 0
                  ? `${q.data.pontosForaHorario} fora do horário`
                  : "Supervisão de presença"}
              </p>
            </Link>

            {/* Fechamentos */}
            <Link
              to="/fechamento"
              className="group p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground group-hover:text-foreground">
                Fechamentos
              </p>
              <p
                className={cn(
                  "mt-1.5 text-2xl font-bold tracking-tight tabular-nums",
                  q.data.fechamentosPendentes > 0 ? "text-primary" : "text-foreground",
                )}
              >
                {q.data.fechamentosPendentes}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                {q.data.fechamentosPendentes > 0 ? "Aprovação pendente" : "Sem pendências"}
              </p>
            </Link>

            {/* Saldo Disponível */}
            <Link
              to="/saldo"
              className="group p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground group-hover:text-foreground">
                Saldo disponível
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground tabular-nums">
                {moeda(q.data.saldoReal)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Conta Pix da agência</p>
            </Link>

            {/* A Transferir */}
            <Link
              to="/financeiro"
              className="group p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground group-hover:text-foreground">
                A transferir
              </p>
              <p
                className={cn(
                  "mt-1.5 text-2xl font-bold tracking-tight tabular-nums",
                  saldoDeficitario ? "text-rose-600 dark:text-rose-400" : "text-foreground",
                )}
              >
                {moeda(q.data.aPagar)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                Pago no ciclo: {moeda(q.data.pago)}
              </p>
            </Link>
          </section>

          {/* 3. Grid Principal: Operação de Eventos (Esq) + Central de Pendências e Finanças (Dir) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            {/* Coluna Principal: Eventos e Operação em Campo */}
            <section className="lg:col-span-8 rounded-2xl border border-border bg-card shadow-2xs overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">Eventos da agência</h2>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ({eventos.length})
                  </span>
                </div>

                {/* Filtro segmentado estilo iOS */}
                <div className="flex items-center gap-1 text-xs bg-muted/60 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setFiltroEventos("todos")}
                    className={cn(
                      "px-2.5 py-1 rounded-lg transition-colors font-medium text-xs",
                      filtroEventos === "todos"
                        ? "bg-card text-foreground shadow-2xs font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Todos
                  </button>
                  {eventosAoVivo.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setFiltroEventos("aovivo")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg transition-colors inline-flex items-center gap-1.5 font-medium text-xs",
                        filtroEventos === "aovivo"
                          ? "bg-card text-foreground shadow-2xs font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Em campo ({eventosAoVivo.length})
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setFiltroEventos("proximos")}
                    className={cn(
                      "px-2.5 py-1 rounded-lg transition-colors font-medium text-xs",
                      filtroEventos === "proximos"
                        ? "bg-card text-foreground shadow-2xs font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Próximos
                  </button>
                </div>
              </div>

              {eventosFiltrados.length === 0 ? (
                <div className="p-8">
                  <EmptyState
                    titulo={
                      filtroEventos === "aovivo"
                        ? "Nenhum evento em campo neste momento"
                        : "Nenhum evento ativo na programação"
                    }
                    descricao={
                      filtroEventos === "aovivo"
                        ? "Os eventos entram em campo quando atingem os status 'Pronto', 'Em Execução' ou 'Encerrando'."
                        : "Crie um novo evento para definir locais, horários, escalar equipes e liberar o ponto por QR Code."
                    }
                    acao={
                      pode("eventos.gerenciar") ? (
                        <Button asChild size="sm">
                          <Link to="/eventos">Criar evento</Link>
                        </Button>
                      ) : null
                    }
                  />
                </div>
              ) : (
                <>
                  {/* Visão Mobile: Lista de cartões com toques rápidos (Mobile App Style) */}
                  <div className="sm:hidden divide-y divide-border/60">
                    {eventosFiltrados.map((ev) => {
                      const emCampo = ["em_execucao", "pronto", "encerrando"].includes(ev.status);
                      return (
                        <div
                          key={ev.id}
                          className="p-3.5 space-y-2.5 active:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <Link
                              to="/eventos/$eventoId"
                              params={{ eventoId: ev.id }}
                              className="font-bold text-sm text-foreground hover:text-primary transition-colors line-clamp-1"
                            >
                              {ev.nome}
                            </Link>
                            <StatusBadge status={ev.status} />
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5 tabular-nums">
                              <CalendarDays className="size-3 text-muted-foreground/70" />
                              {dataHora(ev.data_inicio)}
                            </span>
                            {ev.local ? (
                              <span className="inline-flex items-center gap-1.5 truncate max-w-[170px]">
                                <MapPin className="size-3 text-muted-foreground/70 shrink-0" />
                                {ev.local}
                              </span>
                            ) : null}
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            {emCampo ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                                Em campo agora
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">
                                Detalhes e equipe
                              </span>
                            )}

                            <div className="flex items-center gap-1.5">
                              {emCampo && pode("operacao.supervisionar") ? (
                                <Button
                                  asChild
                                  size="sm"
                                  className="h-8 px-2.5 text-xs gap-1 font-semibold shadow-2xs"
                                >
                                  <Link to="/operacao/$eventoId" params={{ eventoId: ev.id }}>
                                    <Radio className="size-3" /> Ponto
                                  </Link>
                                </Button>
                              ) : null}
                              <Button
                                asChild
                                size="sm"
                                variant="outline"
                                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                              >
                                <Link to="/eventos/$eventoId" params={{ eventoId: ev.id }}>
                                  Abrir <ChevronRight className="size-3 ml-0.5" />
                                </Link>
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Visão Desktop / Tablet: Tabela Limpa */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-border bg-muted/25 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-2.5 sm:px-5">Evento</th>
                          <th className="px-3 py-2.5">Início</th>
                          <th className="px-3 py-2.5">Local</th>
                          <th className="px-3 py-2.5">Status</th>
                          <th className="px-4 py-2.5 text-right sm:px-5">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {eventosFiltrados.map((ev) => {
                          const emCampo = ["em_execucao", "pronto", "encerrando"].includes(
                            ev.status,
                          );
                          return (
                            <tr
                              key={ev.id}
                              className={cn(
                                "transition-colors hover:bg-muted/40",
                                emCampo && "bg-muted/15",
                              )}
                            >
                              <td className="px-4 py-3 sm:px-5">
                                <Link
                                  to="/eventos/$eventoId"
                                  params={{ eventoId: ev.id }}
                                  className="font-semibold text-foreground hover:text-primary hover:underline transition-colors block"
                                >
                                  {ev.nome}
                                </Link>
                                {emCampo ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 font-medium mt-0.5">
                                    <span className="size-1 rounded-full bg-emerald-500" /> Em campo
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-3 text-muted-foreground whitespace-nowrap tabular-nums">
                                {dataHora(ev.data_inicio)}
                              </td>
                              <td className="px-3 py-3 text-muted-foreground truncate max-w-[160px] sm:max-w-[200px]">
                                {ev.local || "—"}
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap">
                                <StatusBadge status={ev.status} />
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap sm:px-5">
                                <div className="flex items-center justify-end gap-1.5">
                                  {emCampo && pode("operacao.supervisionar") ? (
                                    <Button
                                      asChild
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-[11px] gap-1 font-medium"
                                    >
                                      <Link to="/operacao/$eventoId" params={{ eventoId: ev.id }}>
                                        <Radio className="size-3 text-primary" /> Ponto
                                      </Link>
                                    </Button>
                                  ) : null}
                                  <Button
                                    asChild
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                                  >
                                    <Link to="/eventos/$eventoId" params={{ eventoId: ev.id }}>
                                      Detalhes
                                    </Link>
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 sm:px-5 text-xs text-muted-foreground">
                <span className="text-[11px]">Exibindo eventos programados da agência</span>
                <Link
                  to="/eventos"
                  className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary transition-colors text-xs"
                >
                  Ver agenda completa <ChevronRight className="size-3" />
                </Link>
              </div>
            </section>

            {/* Coluna Lateral: Atenção Necessária + Posição Financeira */}
            <aside className="lg:col-span-4 space-y-6">
              {/* Painel de Atenção / Pendências Operacionais */}
              <div className="rounded-lg border border-border bg-card p-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Atenção necessária
                  </h2>
                  {totalPendencias > 0 ? (
                    <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                      {totalPendencias} ação(ões)
                    </span>
                  ) : null}
                </div>

                {totalPendencias === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Nenhuma pendência operacional ou financeira aberta no momento.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-border/60 text-xs">
                    {q.data.pontosPendentes > 0 ? (
                      <li className="py-2.5 first:pt-0">
                        <Link
                          to="/operacao"
                          className="flex items-start justify-between gap-2 group"
                        >
                          <div>
                            <p className="font-semibold text-foreground group-hover:text-primary transition-colors">
                              {q.data.pontosPendentes} ponto(s) aguardando aprovação
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Supervisão de entrada e saída em campo
                            </p>
                          </div>
                          <ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5" />
                        </Link>
                      </li>
                    ) : null}

                    {q.data.pontosForaHorario > 0 ? (
                      <li className="py-2.5">
                        <Link
                          to="/operacao"
                          className="flex items-start justify-between gap-2 group"
                        >
                          <div>
                            <p className="font-semibold text-foreground group-hover:text-primary transition-colors">
                              {q.data.pontosForaHorario} registro(s) fora da tolerância
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Marcações efetuadas fora do horário previsto
                            </p>
                          </div>
                          <ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5" />
                        </Link>
                      </li>
                    ) : null}

                    {q.data.fechamentosPendentes > 0 ? (
                      <li className="py-2.5">
                        <Link
                          to="/fechamento"
                          className="flex items-start justify-between gap-2 group"
                        >
                          <div>
                            <p className="font-semibold text-foreground group-hover:text-primary transition-colors">
                              {q.data.fechamentosPendentes} fechamento(s) para conferência
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Aprovação de horas trabalhadas e valores
                            </p>
                          </div>
                          <ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5" />
                        </Link>
                      </li>
                    ) : null}

                    {q.data.selfiesExpirando > 0 ? (
                      <li className="py-2.5">
                        <Link
                          to="/operacao"
                          className="flex items-start justify-between gap-2 group"
                        >
                          <div>
                            <p className="font-semibold text-foreground group-hover:text-primary transition-colors">
                              {q.data.selfiesExpirando} selfie(s) perto do vencimento
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Retenção documental expira em até 3 dias
                            </p>
                          </div>
                          <ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5" />
                        </Link>
                      </li>
                    ) : null}

                    {q.data.pagamentosFalhos > 0 ? (
                      <li className="py-2.5">
                        <Link
                          to="/financeiro"
                          className="flex items-start justify-between gap-2 group text-rose-600 dark:text-rose-400"
                        >
                          <div>
                            <p className="font-semibold">
                              {q.data.pagamentosFalhos} pagamento(s) com erro Pix
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Chave rejeitada ou saldo insuficiente
                            </p>
                          </div>
                          <ArrowUpRight className="size-3.5 shrink-0 mt-0.5" />
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>

              {/* Posição Financeira e Repasses */}
              <div className="rounded-lg border border-border bg-card p-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Posição de pagamentos
                  </h2>
                  <Link
                    to="/saldo"
                    className="text-[11px] font-medium text-foreground hover:text-primary transition-colors"
                  >
                    Extrato →
                  </Link>
                </div>

                <div className="mt-3 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Saldo disponível em conta</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {moeda(q.data.saldoReal)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Repasses pendentes (Pix)</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {moeda(q.data.aPagar)}
                    </span>
                  </div>

                  <div className="border-t border-border pt-2 flex items-center justify-between">
                    <span className="font-medium text-muted-foreground">Balanço líquido</span>
                    <span
                      className={cn(
                        "font-bold tabular-nums",
                        saldoLiquido < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground",
                      )}
                    >
                      {moeda(saldoLiquido)}
                    </span>
                  </div>

                  {saldoDeficitario ? (
                    <div className="pt-2">
                      <p className="text-[11px] text-rose-700 dark:text-rose-400 font-medium">
                        Saldo insuficiente para quitar todos os repasses. Aporte necessário de{" "}
                        {moeda(Math.abs(saldoLiquido))}.
                      </p>
                      {pode("financeiro.gerenciar") ? (
                        <Button
                          asChild
                          size="sm"
                          variant="destructive"
                          className="mt-2 w-full h-8 text-xs font-medium"
                        >
                          <Link to="/saldo">Recarregar saldo via Pix</Link>
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Saldo suficiente para cobrir os pagamentos pendentes na fila.
                    </p>
                  )}
                </div>
              </div>

              {/* Atalhos Rápidos Contextuais */}
              <div className="rounded-lg border border-border bg-card p-4 shadow-2xs">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-3">
                  Atalhos operacionais
                </h2>
                <div className="mt-2 divide-y divide-border/60 text-xs">
                  {pode("cadastros.gerenciar") ? (
                    <Link
                      to="/freelancers"
                      className="flex items-center justify-between py-2 text-muted-foreground hover:text-foreground transition-colors group"
                    >
                      <span>Cadastrar novo colaborador</span>
                      <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-foreground" />
                    </Link>
                  ) : null}
                  {pode("operacao.supervisionar") ? (
                    <Link
                      to="/operacao"
                      className="flex items-center justify-between py-2 text-muted-foreground hover:text-foreground transition-colors group"
                    >
                      <span>Supervisão geral de presença</span>
                      <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-foreground" />
                    </Link>
                  ) : null}
                  {pode("relatorios.ver") ? (
                    <Link
                      to="/relatorios"
                      className="flex items-center justify-between py-2 text-muted-foreground hover:text-foreground transition-colors group"
                    >
                      <span>Relatórios e exportação CSV</span>
                      <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-foreground" />
                    </Link>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}
    </AppShell>
  );
}
