import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Eye,
  Image,
  MapPin,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingBloco } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useSessao } from "@/hooks/use-sessao";
import {
  carregarOperacaoEvento,
  decidirPonto as decidirPontoSeguro,
  lancarPontoManual,
} from "@/lib/operacao.functions";
import { hora, ROTULO_METODO, ROTULO_TIPO_PONTO, type TipoPonto } from "@/lib/dominio";

export const Route = createFileRoute("/_authenticated/operacao/$eventoId")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Ponto da equipe — Já" },
      {
        name: "description",
        content:
          "Aprove ou recuse os registros de ponto, lance ponto manual e registre ocorrências da equipe em campo.",
      },
      { property: "og:title", content: "Ponto da equipe — Já" },
      {
        property: "og:description",
        content: "Conferência de presença e ponto durante o evento.",
      },
    ],
  }),
  component: OperacaoEvento,
});

const TIPOS: TipoPonto[] = ["entrada", "inicio_intervalo", "fim_intervalo", "saida"];

function OperacaoEvento() {
  const { eventoId } = Route.useParams();
  const queryClient = useQueryClient();
  const { sessao } = useSessao();
  const [evidenciaAberta, setEvidenciaAberta] = useState<{
    url: string | null;
    nome: string;
    funcao?: string | null;
    registradoEm: string;
    pontoId: string;
    escalaId: string;
    status: string;
    gpsLat?: number | null;
    gpsLng?: number | null;
    tipo: TipoPonto;
    metodo: string;
    foraHorario?: boolean;
  } | null>(null);
  const [manual, setManual] = useState<{ escalaId: string; nome: string } | null>(null);
  const [recusando, setRecusando] = useState<{ pontoId: string; escalaId: string } | null>(null);
  const [ocorrencia, setOcorrencia] = useState<{ escalaId: string; nome: string } | null>(null);
  const [filtro, setFiltro] = useState<
    "todos" | "pendentes" | "presentes" | "concluidos" | "sem_ponto"
  >("todos");
  const decidirFn = useServerFn(decidirPontoSeguro);
  const carregarFn = useServerFn(carregarOperacaoEvento);

  const evento = useQuery({
    queryKey: ["evento", eventoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eventos")
        .select("id, nome, status, local")
        .eq("id", eventoId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Evento não encontrado.");
      return data;
    },
  });

  const equipes = useQuery({
    queryKey: ["operacao", eventoId],
    queryFn: async () => {
      try {
        const dados = await carregarFn({ data: { eventoId } });
        if (dados && Array.isArray(dados)) {
          return dados;
        }
      } catch (err) {
        console.warn("[operacao] Falha ao carregar via server function, usando query direta:", err);
      }

      const { data, error } = await supabase
        .from("equipes")
        .select(
          "id, nome, escalas(id, status, freelancers(nome, funcao), pontos(id, tipo, metodo, registrado_em, status, foto_url, gps_lat, gps_lng, fora_horario, motivo_recusa, selfie_expira_em), ocorrencias(id, descricao, criado_em))",
        )
        .eq("evento_id", eventoId)
        .order("criado_em");

      if (error) {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from("equipes")
          .select(
            "id, nome, escalas(id, status, freelancers(nome, funcao), pontos(id, tipo, metodo, registrado_em, status, foto_url, gps_lat, gps_lng), ocorrencias(id, descricao, criado_em))",
          )
          .eq("evento_id", eventoId)
          .order("criado_em");

        if (fallbackError) throw fallbackError;
        return (fallbackData ?? []).map((eq) => ({
          ...eq,
          escalas: (eq.escalas ?? []).map((es) => ({
            ...es,
            pontos: (es.pontos ?? []).map((p: Record<string, unknown>) => ({
              ...p,
              fora_horario: p["fora_horario"] ?? false,
              motivo_recusa: p["motivo_recusa"] ?? null,
              selfie_expira_em: p["selfie_expira_em"] ?? null,
            })),
          })),
        })) as unknown as typeof data;
      }

      return data;
    },
    refetchInterval: 5000,
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["operacao", eventoId] });
    queryClient.invalidateQueries({ queryKey: ["painel"] });
  };

  const decidirPonto = useMutation({
    mutationFn: async ({
      pontoId,
      escalaId,
      status,
      motivo,
    }: {
      pontoId: string;
      escalaId: string;
      status: "aprovado" | "recusado";
      motivo?: string;
    }) => {
      await decidirFn({ data: { pontoId, escalaId, status, motivo } });
    },
    onSuccess: () => {
      invalidar();
      setRecusando(null);
      toast.success("Decisão registrada no histórico.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Calculate operational metrics across teams
  const todasEscalas = (equipes.data ?? []).flatMap((q) =>
    q.escalas.filter((es) => es.status !== "substituido" && es.status !== "recusado"),
  );
  const totalEscalados = todasEscalas.length;
  const totalConcluidos = todasEscalas.filter((es) =>
    es.pontos.some((p) => p.tipo === "saida" && p.status !== "recusado"),
  ).length;
  const totalPresentes = todasEscalas.filter(
    (es) =>
      es.pontos.some((p) => p.tipo === "entrada" && p.status !== "recusado") &&
      !es.pontos.some((p) => p.tipo === "saida" && p.status !== "recusado"),
  ).length;
  const totalComPonto = todasEscalas.filter((es) => es.pontos.length > 0).length;
  const todosPontosPendentes = todasEscalas.flatMap((es) =>
    es.pontos
      .filter((p) => p.status === "pendente")
      .map((p) => ({ pontoId: p.id, escalaId: es.id })),
  );
  const totalPendentes = todosPontosPendentes.length;
  const totalOcorrencias = (equipes.data ?? []).reduce(
    (acc, q) => acc + q.escalas.reduce((accE, es) => accE + es.ocorrencias.length, 0),
    0,
  );

  const aprovarTodos = useMutation({
    mutationFn: async () => {
      if (todosPontosPendentes.length === 0) return;
      for (const item of todosPontosPendentes) {
        await decidirFn({
          data: {
            pontoId: item.pontoId,
            escalaId: item.escalaId,
            status: "aprovado",
          },
        });
      }
    },
    onSuccess: () => {
      invalidar();
      toast.success(`${totalPendentes} ponto(s) aprovado(s) com sucesso.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function abrirEvidencia(
    p: {
      id: string;
      tipo: TipoPonto;
      metodo: string;
      registrado_em: string;
      status: string;
      foto_url: string | null;
      gps_lat: number | null;
      gps_lng: number | null;
      fora_horario?: boolean;
    },
    nome: string,
    funcao?: string | null,
    escalaId?: string,
  ) {
    let fotoUrl = p.foto_url;
    if (fotoUrl) {
      const isDirectUrl =
        fotoUrl.startsWith("data:") ||
        fotoUrl.startsWith("http://") ||
        fotoUrl.startsWith("https://") ||
        fotoUrl.startsWith("blob:");

      if (!isDirectUrl) {
        try {
          const { data, error } = await supabase.storage
            .from("selfies-ponto")
            .createSignedUrl(fotoUrl, 3600);
          if (!error && data?.signedUrl) {
            fotoUrl = data.signedUrl;
          } else {
            const { data: pubData } = supabase.storage.from("selfies-ponto").getPublicUrl(fotoUrl);
            if (pubData?.publicUrl) fotoUrl = pubData.publicUrl;
          }
        } catch {
          // Continua com url original se houver falha
        }
      }
    }

    setEvidenciaAberta({
      url: fotoUrl,
      nome,
      funcao,
      registradoEm: p.registrado_em,
      pontoId: p.id,
      escalaId: escalaId ?? "",
      status: p.status,
      gpsLat: p.gps_lat,
      gpsLng: p.gps_lng,
      tipo: p.tipo,
      metodo: p.metodo,
      foraHorario: p.fora_horario,
    });
  }

  if (evento.isPending) {
    return (
      <AppShell titulo="Operação">
        <LoadingBloco />
      </AppShell>
    );
  }
  if (evento.isError) {
    return (
      <AppShell titulo="Operação">
        <ErrorState error={evento.error} onRetry={() => evento.refetch()} />
      </AppShell>
    );
  }

  return (
    <AppShell
      titulo={evento.data.nome}
      descricao={`Operação em campo & Folha de Ponto${evento.data.local ? ` · ${evento.data.local}` : ""}`}
      acoes={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              invalidar();
              toast.success("Atualizando registros de presença...");
            }}
            disabled={equipes.isFetching}
            className="h-8 text-xs font-medium"
            title="Sincronizar batidas em tempo real"
          >
            <RefreshCw className={cn("size-3.5 mr-1", equipes.isFetching && "animate-spin")} />
            {equipes.isFetching ? "Sincronizando..." : "Sincronizar"}
          </Button>

          {totalPendentes > 0 ? (
            <Button
              size="sm"
              onClick={() => aprovarTodos.mutate()}
              disabled={aprovarTodos.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
            >
              <Check className="size-3.5 mr-1" />
              {aprovarTodos.isPending ? "Aprovando..." : `Aprovar Todos (${totalPendentes})`}
            </Button>
          ) : null}
          <StatusBadge status={evento.data.status} />
        </div>
      }
    >
      {/* Executive KPI Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <p className="text-xs font-medium text-muted-foreground">Total Escalados</p>
          <p className="mt-1.5 text-2xl font-bold text-foreground">{totalEscalados}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Colaboradores no evento</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <p className="text-xs font-medium text-muted-foreground">Em Campo</p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {totalPresentes}
            </span>
            <span className="text-xs text-muted-foreground">
              ({totalEscalados > 0 ? Math.round((totalPresentes / totalEscalados) * 100) : 0}%)
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Com entrada ativa</p>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-xs">
          <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
            Jornadas Concluídas
          </p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {totalConcluidos}
            </span>
            <span className="text-xs text-muted-foreground">
              ({totalEscalados > 0 ? Math.round((totalConcluidos / totalEscalados) * 100) : 0}%)
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Saída registrada</p>
        </div>

        <div
          className={cn(
            "rounded-xl border p-4 shadow-xs transition-colors",
            totalPendentes > 0 ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-card",
          )}
        >
          <p className="text-xs font-medium text-muted-foreground">Pontos a Conferir</p>
          <p
            className={cn(
              "mt-1.5 text-2xl font-bold",
              totalPendentes > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground",
            )}
          >
            {totalPendentes}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Aguardando decisão</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <p className="text-xs font-medium text-muted-foreground">Ocorrências</p>
          <p className="mt-1.5 text-2xl font-bold text-foreground">{totalOcorrencias}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Registros da equipe</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={filtro === "todos" ? "default" : "outline"}
          onClick={() => setFiltro("todos")}
          className="h-8 text-xs font-medium"
        >
          Todos ({totalEscalados})
        </Button>
        <Button
          size="sm"
          variant={filtro === "pendentes" ? "default" : "outline"}
          onClick={() => setFiltro("pendentes")}
          className={cn(
            "h-8 text-xs font-medium",
            totalPendentes > 0 && filtro !== "pendentes" && "border-amber-500/50 text-amber-600",
          )}
        >
          Pendentes ({totalPendentes})
        </Button>
        <Button
          size="sm"
          variant={filtro === "presentes" ? "default" : "outline"}
          onClick={() => setFiltro("presentes")}
          className="h-8 text-xs font-medium"
        >
          Em Campo ({totalPresentes})
        </Button>
        <Button
          size="sm"
          variant={filtro === "concluidos" ? "default" : "outline"}
          onClick={() => setFiltro("concluidos")}
          className={cn(
            "h-8 text-xs font-medium",
            totalConcluidos > 0 &&
              filtro !== "concluidos" &&
              "border-emerald-500/50 text-emerald-600",
          )}
        >
          Jornada Concluída ({totalConcluidos})
        </Button>
        <Button
          size="sm"
          variant={filtro === "sem_ponto" ? "default" : "outline"}
          onClick={() => setFiltro("sem_ponto")}
          className="h-8 text-xs font-medium"
        >
          Sem Ponto ({totalEscalados - totalComPonto})
        </Button>
      </div>
      {equipes.isPending ? (
        <LoadingBloco />
      ) : equipes.isError ? (
        <ErrorState error={equipes.error} onRetry={() => equipes.refetch()} />
      ) : !equipes.data || equipes.data.length === 0 ? (
        <EmptyState titulo="Sem equipes" descricao="Monte a equipe e a escala na tela do evento." />
      ) : (
        <div className="space-y-4">
          {(equipes.data ?? []).map((q) => {
            const escalasFiltradas = q.escalas
              .filter((es) => es.status !== "substituido" && es.status !== "recusado")
              .filter((es) => {
                const pontosValidos = es.pontos.filter((p) => p.status !== "recusado");
                const temSaida = pontosValidos.some((p) => p.tipo === "saida");
                const temEntrada = pontosValidos.some((p) => p.tipo === "entrada");
                if (filtro === "pendentes") return es.pontos.some((p) => p.status === "pendente");
                if (filtro === "presentes") return temEntrada && !temSaida;
                if (filtro === "concluidos") return temSaida;
                if (filtro === "sem_ponto") return es.pontos.length === 0;
                return true;
              });

            if (filtro !== "todos" && escalasFiltradas.length === 0) return null;

            return (
              <section key={q.id} className="rounded-md border border-border bg-card">
                <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">{q.nome}</h2>
                <ul className="divide-y divide-border">
                  {escalasFiltradas.length === 0 ? (
                    <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                      Nenhum colaborador nesta equipe com o filtro selecionado.
                    </li>
                  ) : (
                    escalasFiltradas.map((es) => {
                      const pontosValidos = es.pontos.filter((p) => p.status !== "recusado");
                      const temSaida = pontosValidos.some((p) => p.tipo === "saida");
                      const temEntrada = pontosValidos.some((p) => p.tipo === "entrada");
                      const temInicioIntervalo = pontosValidos.some(
                        (p) => p.tipo === "inicio_intervalo",
                      );
                      const temFimIntervalo = pontosValidos.some((p) => p.tipo === "fim_intervalo");
                      const isJornadaConcluida = temSaida;
                      const isEmIntervalo = temInicioIntervalo && !temFimIntervalo;
                      const isEmCampo = temEntrada && !temSaida && !isEmIntervalo;

                      return (
                        <li key={es.id} className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{es.freelancers?.nome}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {es.freelancers?.funcao ?? "sem função definida"}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {/* Status da Jornada e Presença */}
                              {isJornadaConcluida ? (
                                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shadow-xs">
                                  <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
                                  Jornada concluída
                                </span>
                              ) : isEmIntervalo ? (
                                <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 shadow-xs">
                                  <Clock className="size-3 text-amber-600 dark:text-amber-400" />
                                  Em intervalo
                                </span>
                              ) : isEmCampo ? (
                                <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/40 bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300 shadow-xs">
                                  <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
                                  Em campo
                                </span>
                              ) : (
                                <StatusBadge status={es.status} />
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setManual({
                                    escalaId: es.id,
                                    nome: es.freelancers?.nome ?? "",
                                  })
                                }
                              >
                                <Plus className="size-4" /> Ponto manual
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setOcorrencia({
                                    escalaId: es.id,
                                    nome: es.freelancers?.nome ?? "",
                                  })
                                }
                              >
                                Ocorrência
                              </Button>
                            </div>
                          </div>

                          {es.pontos.length > 0 ? (
                            <ul className="mt-2 space-y-1">
                              {[...es.pontos]
                                .sort(
                                  (a, b) =>
                                    new Date(a.registrado_em).getTime() -
                                    new Date(b.registrado_em).getTime(),
                                )
                                .map((p) => (
                                  <li
                                    key={p.id}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md bg-muted/40 border border-border/50 px-2.5 py-2 text-xs hover:bg-muted/60 transition-colors"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-semibold text-foreground">
                                        {ROTULO_TIPO_PONTO[p.tipo]}
                                      </span>
                                      <span className="text-muted-foreground">
                                        {hora(p.registrado_em)} · {ROTULO_METODO[p.metodo]}
                                      </span>
                                      {p.fora_horario ? (
                                        <span className="rounded-sm bg-status-pendente px-1.5 py-0.5 text-status-pendente-foreground font-medium">
                                          Fora do horário
                                        </span>
                                      ) : null}
                                      {p.motivo_recusa ? (
                                        <span className="block w-full font-normal text-destructive">
                                          Motivo: {p.motivo_recusa}
                                        </span>
                                      ) : null}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {/* Botão Ver Foto e Localização */}
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs font-medium gap-1 text-primary hover:bg-primary/5"
                                        title="Visualizar foto, horário e dados de localização"
                                        onClick={() =>
                                          void abrirEvidencia(
                                            p,
                                            es.freelancers?.nome ?? "Colaborador",
                                            es.freelancers?.funcao,
                                            es.id,
                                          )
                                        }
                                      >
                                        {p.foto_url ? (
                                          <Image className="size-3.5 text-emerald-600" />
                                        ) : (
                                          <Eye className="size-3.5 text-muted-foreground" />
                                        )}
                                        <span>{p.foto_url ? "Foto & Local" : "Ver Local"}</span>
                                      </Button>

                                      {/* Botão / Link GPS Direto */}
                                      {p.gps_lat != null && p.gps_lng != null ? (
                                        <a
                                          href={`https://www.google.com/maps?q=${p.gps_lat},${p.gps_lng}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center gap-1 h-7 rounded-md border border-border bg-card px-2 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                                          title={`Ver localização no Google Maps (${p.gps_lat.toFixed(4)}, ${p.gps_lng.toFixed(4)})`}
                                        >
                                          <MapPin className="size-3 text-rose-500" />
                                          <span>GPS</span>
                                          <ExternalLink className="size-2.5 text-muted-foreground" />
                                        </a>
                                      ) : (
                                        <span
                                          className="inline-flex items-center gap-1 h-7 rounded-md border border-dashed border-border/70 px-1.5 text-[11px] text-muted-foreground opacity-70"
                                          title="GPS não informado"
                                        >
                                          <MapPin className="size-3 opacity-40" />
                                          <span>Sem GPS</span>
                                        </span>
                                      )}

                                      <StatusBadge status={p.status} />

                                      {/* Ações de Aprovação / Recusa */}
                                      {p.status === "pendente" ? (
                                        <div className="flex items-center gap-1">
                                          <Button
                                            size="sm"
                                            className="h-7 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                                            onClick={() =>
                                              decidirPonto.mutate({
                                                pontoId: p.id,
                                                escalaId: es.id,
                                                status: "aprovado",
                                              })
                                            }
                                            disabled={decidirPonto.isPending}
                                          >
                                            <Check className="size-3.5 mr-1" /> Aprovar
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 px-2 text-destructive hover:bg-destructive/10 border-border"
                                            title="Recusar ponto"
                                            onClick={() =>
                                              setRecusando({ pontoId: p.id, escalaId: es.id })
                                            }
                                            disabled={decidirPonto.isPending}
                                          >
                                            <X className="size-3.5" />
                                          </Button>
                                        </div>
                                      ) : null}
                                    </div>
                                  </li>
                                ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Nenhum ponto registrado.
                            </p>
                          )}

                          {es.ocorrencias.length > 0 ? (
                            <ul className="mt-2 space-y-1">
                              {es.ocorrencias.map((o) => (
                                <li
                                  key={o.id}
                                  className="rounded-sm border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground"
                                >
                                  {o.descricao}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(manual)} onOpenChange={(o) => !o && setManual(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ponto manual — {manual?.nome}</DialogTitle>
          </DialogHeader>
          {manual ? (
            <FormPontoManual
              escalaId={manual.escalaId}
              onFechar={() => setManual(null)}
              onSalvo={invalidar}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(recusando)} onOpenChange={(o) => !o && setRecusando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recusar ponto</DialogTitle>
          </DialogHeader>
          {recusando ? (
            <FormRecusa
              onCancelar={() => setRecusando(null)}
              onConfirmar={(motivo) =>
                decidirPonto.mutate({ ...recusando, status: "recusado", motivo })
              }
              salvando={decidirPonto.isPending}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(ocorrencia)} onOpenChange={(o) => !o && setOcorrencia(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ocorrência — {ocorrencia?.nome}</DialogTitle>
          </DialogHeader>
          {ocorrencia ? (
            <FormOcorrencia
              escalaId={ocorrencia.escalaId}
              usuarioId={sessao?.usuario.id ?? null}
              onFechar={() => setOcorrencia(null)}
              onSalvo={invalidar}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(evidenciaAberta)} onOpenChange={(o) => !o && setEvidenciaAberta(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-4 text-base">
              <span>Evidência de Ponto — {evidenciaAberta?.nome}</span>
              {evidenciaAberta ? <StatusBadge status={evidenciaAberta.status} /> : null}
            </DialogTitle>
          </DialogHeader>
          {evidenciaAberta ? (
            <div className="space-y-4 pt-1">
              {/* Metadados do ponto */}
              <div className="flex flex-wrap items-center gap-2 text-xs bg-muted/50 p-2.5 rounded-lg border border-border">
                <span className="font-semibold text-foreground">
                  {ROTULO_TIPO_PONTO[evidenciaAberta.tipo]}
                </span>
                <span className="text-muted-foreground">•</span>
                <span>{ROTULO_METODO[evidenciaAberta.metodo]}</span>
                <span className="text-muted-foreground">•</span>
                <span>
                  {new Date(evidenciaAberta.registradoEm).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "medium",
                  })}
                </span>
                {evidenciaAberta.foraHorario ? (
                  <span className="rounded-sm bg-status-pendente px-1.5 py-0.5 text-status-pendente-foreground font-medium">
                    Fora do horário
                  </span>
                ) : null}
              </div>

              {/* Foto do colaborador */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Image className="size-3.5 text-primary" />
                    Selfie de Presença
                  </span>
                  {evidenciaAberta.url ? (
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <a href={evidenciaAberta.url} download={`ponto-${evidenciaAberta.nome}.jpg`}>
                        <Download className="size-3 mr-1" /> Baixar Imagem
                      </a>
                    </Button>
                  ) : null}
                </div>

                {evidenciaAberta.url ? (
                  <div className="relative overflow-hidden rounded-lg border border-border bg-black/5 dark:bg-black/30 flex items-center justify-center p-1">
                    <img
                      src={evidenciaAberta.url}
                      alt={`Registro de ponto de ${evidenciaAberta.nome}`}
                      className="max-h-[46vh] w-full rounded object-contain"
                    />
                  </div>
                ) : (
                  <div className="p-8 text-center rounded-lg border border-dashed border-border text-muted-foreground text-xs">
                    <Image className="size-8 mx-auto mb-2 opacity-30" />
                    Nenhuma foto associada a este ponto.
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  A foto é evidência humana de conferência registrada com consentimento do
                  colaborador e não compõe cálculo financeiro.
                </p>
              </div>

              {/* Localização GPS */}
              <div className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <MapPin className="size-4 text-rose-500" />
                    Localização no Momento da Marcação
                  </span>
                  {evidenciaAberta.gpsLat != null && evidenciaAberta.gpsLng != null ? (
                    <span className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {evidenciaAberta.gpsLat.toFixed(5)}, {evidenciaAberta.gpsLng.toFixed(5)}
                    </span>
                  ) : null}
                </div>

                {evidenciaAberta.gpsLat != null && evidenciaAberta.gpsLng != null ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Coordenadas capturadas via geolocalização do dispositivo ao confirmar
                      presença.
                    </p>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 border-border hover:bg-muted font-medium"
                    >
                      <a
                        href={`https://www.google.com/maps?q=${evidenciaAberta.gpsLat},${evidenciaAberta.gpsLng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin className="size-3.5 text-rose-500" />
                        Abrir Localização no Google Maps
                        <ExternalLink className="size-3 ml-auto text-muted-foreground" />
                      </a>
                    </Button>
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-border/80 p-2.5 text-center text-xs text-muted-foreground">
                    Localização GPS não fornecida pelo navegador ou aparelho no momento do registro.
                  </div>
                )}
              </div>

              {/* Ações de decisão rápida dentro da modal */}
              {evidenciaAberta.status === "pendente" ? (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-3 border-t border-border">
                  <Button
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10 border-border"
                    onClick={() => {
                      const pend = {
                        pontoId: evidenciaAberta.pontoId,
                        escalaId: evidenciaAberta.escalaId,
                      };
                      setEvidenciaAberta(null);
                      setRecusando(pend);
                    }}
                    disabled={decidirPonto.isPending}
                  >
                    <X className="size-4 mr-1" /> Recusar Ponto...
                  </Button>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                    onClick={() => {
                      decidirPonto.mutate({
                        pontoId: evidenciaAberta.pontoId,
                        escalaId: evidenciaAberta.escalaId,
                        status: "aprovado",
                      });
                      setEvidenciaAberta(null);
                    }}
                    disabled={decidirPonto.isPending}
                  >
                    <Check className="size-4 mr-1" /> Aprovar Registro de Ponto
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end pt-2 border-t border-border">
                  <Button variant="outline" onClick={() => setEvidenciaAberta(null)}>
                    Fechar
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function FormPontoManual({
  escalaId,
  onFechar,
  onSalvo,
}: {
  escalaId: string;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const lancarFn = useServerFn(lancarPontoManual);
  const [tipo, setTipo] = useState<TipoPonto>("entrada");
  const [quando, setQuando] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
  );

  const salvar = useMutation({
    mutationFn: async () => {
      await lancarFn({ data: { escalaId, tipo, registradoEm: new Date(quando).toISOString() } });
    },
    onSuccess: () => {
      toast.success("Ponto lançado.");
      onSalvo();
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="pm-tipo">Tipo</Label>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoPonto)}>
          <SelectTrigger id="pm-tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS.map((t) => (
              <SelectItem key={t} value={t}>
                {ROTULO_TIPO_PONTO[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pm-quando">Data e hora</Label>
        <input
          id="pm-quando"
          type="datetime-local"
          required
          value={quando}
          onChange={(e) => setQuando(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Lançamento manual entra já aprovado, sob responsabilidade do supervisor.
      </p>
      <DialogFooter>
        <Button type="submit" disabled={salvar.isPending}>
          Lançar ponto
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormRecusa({
  onCancelar,
  onConfirmar,
  salvando,
}: {
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
  salvando: boolean;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!motivo.trim()) return;
        onConfirmar(motivo.trim());
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="motivo-recusa">Motivo da recusa</Label>
        <Textarea
          id="motivo-recusa"
          required
          maxLength={500}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" variant="destructive" disabled={salvando || !motivo.trim()}>
          Recusar ponto
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormOcorrencia({
  escalaId,
  usuarioId,
  onFechar,
  onSalvo,
}: {
  escalaId: string;
  usuarioId: string | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [descricao, setDescricao] = useState("");
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("ocorrencias").insert({
        escala_id: escalaId,
        registrado_por_id: usuarioId,
        descricao: descricao.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ocorrência registrada.");
      onSalvo();
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="oc-desc">O que aconteceu</Label>
        <Textarea
          id="oc-desc"
          required
          rows={4}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Atraso, saída antecipada, troca de posto…"
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={salvar.isPending}>
          Registrar
        </Button>
      </DialogFooter>
    </form>
  );
}
