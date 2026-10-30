import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingBloco } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  dataHora,
  moeda,
  ORDEM_STATUS_EVENTO,
  ETAPAS_FINALIZACAO,
  ehEtapaFinalizacao,
  proximoStatus,
  statusAnterior,
  podeCancelar,
  ROTULO_STATUS_EVENTO,
  ROTULO_TIPO_VALOR,
  validarTransicao,
  calcularStatusSugeridoEvento,
  type StatusEvento,
  type TipoValor,
} from "@/lib/dominio";
import { parseValorPositivo } from "@/lib/moeda";
import { rotacionarQrEvento } from "@/lib/operacao.functions";
import { sincronizarPontoEvento } from "@/lib/ponto.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/eventos/$eventoId")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Evento — Já" },
      {
        name: "description",
        content:
          "Equipe, escala, confirmações, QR Code de ponto e avanço do ciclo do evento na sua agência.",
      },
      { property: "og:title", content: "Evento — Já" },
      {
        property: "og:description",
        content: "Gerencie equipe, escala e o ciclo do evento.",
      },
    ],
  }),
  component: DetalheEvento,
});

function useEvento(eventoId: string) {
  return useQuery({
    queryKey: ["evento", eventoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eventos")
        .select("*, clientes(nome)")
        .eq("id", eventoId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Evento não encontrado.");
      return data;
    },
  });
}

function useEquipes(eventoId: string) {
  return useQuery({
    queryKey: ["equipes", eventoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipes")
        .select("*, usuarios(nome), escalas(*, freelancers(id, nome, funcao, chave_pix))")
        .eq("evento_id", eventoId)
        .order("criado_em");
      if (error) throw error;
      return data;
    },
  });
}

function Stepper({
  atual,
  onMudarStatus,
  carregando,
}: {
  atual: StatusEvento;
  onMudarStatus?: (novo: StatusEvento) => void;
  carregando?: boolean;
}) {
  if (atual === "cancelado") return <StatusBadge status="cancelado" />;
  const idx = ORDEM_STATUS_EVENTO.indexOf(atual);

  return (
    <div className="space-y-2 w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        {ORDEM_STATUS_EVENTO.map((s, i) => {
          const ehAtivo = i === idx;
          const ehPassado = i < idx;
          const ehFinalizacao = ehEtapaFinalizacao(s);

          return (
            <button
              key={s}
              type="button"
              disabled={carregando}
              onClick={() => {
                if (onMudarStatus && s !== atual) {
                  onMudarStatus(s);
                }
              }}
              className={cn(
                "group relative rounded-lg px-2.5 py-1 text-xs font-medium transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed select-none",
                ehAtivo &&
                  "bg-blue-600 text-white shadow-xs font-bold ring-2 ring-blue-500/30 scale-[1.02]",
                ehPassado && "bg-muted/70 text-foreground hover:bg-muted border border-border/70",
                !ehAtivo &&
                  !ehPassado &&
                  ehFinalizacao &&
                  "border border-dashed border-blue-400 bg-blue-50/50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100/60 font-semibold",
                !ehAtivo &&
                  !ehPassado &&
                  !ehFinalizacao &&
                  "border border-dashed border-border text-muted-foreground hover:bg-muted/50",
              )}
              title={
                ehAtivo
                  ? `Etapa atual: ${ROTULO_STATUS_EVENTO[s]}`
                  : `Mudar manualmente para ${ROTULO_STATUS_EVENTO[s]}`
              }
            >
              {ehPassado && <Check className="size-3 text-emerald-600 shrink-0" />}
              {ehAtivo && (
                <span className="size-1.5 rounded-full bg-white animate-pulse shrink-0" />
              )}
              <span>{ROTULO_STATUS_EVENTO[s]}</span>
              {ehFinalizacao && (
                <span
                  className={cn(
                    "text-[9px] px-1 py-0.2 rounded-xs font-semibold",
                    ehAtivo
                      ? "bg-white/20 text-white"
                      : "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200",
                  )}
                >
                  Manual
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground pt-0.5">
        <span className="inline-flex items-center gap-1">
          <Sparkles className="size-3 text-amber-500" />
          <span>
            <strong>Montagem automática:</strong> Planejamento → Escala → Confirmações → Pronto → Em
            execução
          </span>
        </span>
        <span className="hidden sm:inline">•</span>
        <span className="inline-flex items-center gap-1">
          <SlidersHorizontal className="size-3 text-blue-500" />
          <span>
            <strong>Etapas de finalização:</strong> Fechamento → Pagamento → Concluído (controle
            manual)
          </span>
        </span>
      </div>
    </div>
  );
}

function FormEquipe({
  eventoId,
  eventoStatus,
  onFechar,
}: {
  eventoId: string;
  eventoStatus: StatusEvento;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [nome, setNome] = useState("");
  const [supervisorId, setSupervisorId] = useState("");

  const usuarios = useQuery({
    queryKey: ["usuarios"],
    queryFn: async () => {
      const { data, error } = await supabase.from("usuarios").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("equipes").insert({
        evento_id: eventoId,
        nome: nome.trim(),
        supervisor_id: supervisorId || null,
      });
      if (error) throw error;

      if (eventoStatus === "planejamento") {
        await supabase.from("eventos").update({ status: "escala" }).eq("id", eventoId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipes", eventoId] });
      queryClient.invalidateQueries({ queryKey: ["evento", eventoId] });
      queryClient.invalidateQueries({ queryKey: ["eventos"] });
      toast.success(
        eventoStatus === "planejamento"
          ? "Equipe criada! O evento avançou automaticamente para 'Escala'."
          : "Equipe criada com sucesso.",
      );
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        criar.mutate();
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="q-nome">Nome da equipe</Label>
        <Input
          id="q-nome"
          required
          placeholder="Bar, recepção, montagem…"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="q-sup">Supervisor</Label>
        <Select value={supervisorId} onValueChange={setSupervisorId}>
          <SelectTrigger id="q-sup">
            <SelectValue placeholder="Sem supervisor" />
          </SelectTrigger>
          <SelectContent>
            {(usuarios.data ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={criar.isPending}>
          Criar equipe
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormEscala({
  eventoId,
  equipeId,
  eventoStatus,
  substituindo,
  onFechar,
}: {
  eventoId: string;
  equipeId: string;
  eventoStatus: StatusEvento;
  substituindo?: { id: string; valor: number; tipo: TipoValor };
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [freelancerId, setFreelancerId] = useState("");
  const [valor, setValor] = useState(String(substituindo?.valor ?? ""));
  const [tipo, setTipo] = useState<TipoValor>(substituindo?.tipo ?? "diaria");

  const freelancers = useQuery({
    queryKey: ["freelancers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("freelancers")
        .select("*")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const valorNumerico = parseValorPositivo(valor);
      const { data, error } = await supabase
        .from("escalas")
        .insert({
          equipe_id: equipeId,
          freelancer_id: freelancerId,
          valor_combinado: valorNumerico,
          tipo_valor: tipo,
          status: "convidado",
          convite_enviado_em: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;

      if (substituindo) {
        const { error: erro2 } = await supabase
          .from("escalas")
          .update({ status: "substituido", substituido_por_id: data.id })
          .eq("id", substituindo.id);
        if (erro2) throw erro2;
      }

      if (["planejamento", "escala"].includes(eventoStatus)) {
        await supabase.from("eventos").update({ status: "confirmacoes" }).eq("id", eventoId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipes", eventoId] });
      queryClient.invalidateQueries({ queryKey: ["evento", eventoId] });
      queryClient.invalidateQueries({ queryKey: ["eventos"] });
      toast.success(
        substituindo
          ? "Substituição registrada."
          : ["planejamento", "escala"].includes(eventoStatus)
            ? "Convite enviado! O evento avançou automaticamente para 'Confirmações'."
            : "Convite enviado.",
      );
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!freelancerId) {
          toast.error("Escolha o freelancer.");
          return;
        }
        salvar.mutate();
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="es-free">Freelancer</Label>
        <Select value={freelancerId} onValueChange={setFreelancerId}>
          <SelectTrigger id="es-free">
            <SelectValue placeholder="Escolher freelancer" />
          </SelectTrigger>
          <SelectContent>
            {(freelancers.data ?? []).map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.nome}
                {f.funcao ? ` — ${f.funcao}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="es-valor">Valor combinado (R$)</Label>
          <Input
            id="es-valor"
            required
            inputMode="decimal"
            placeholder="0,00"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es-tipo">Tipo</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoValor)}>
            <SelectTrigger id="es-tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="diaria">Diária</SelectItem>
              <SelectItem value="hora">Por hora</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={salvar.isPending}>
          {substituindo ? "Substituir" : "Escalar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DetalheEvento() {
  const { eventoId } = Route.useParams();
  const queryClient = useQueryClient();
  const evento = useEvento(eventoId);
  const equipes = useEquipes(eventoId);
  const [novaEquipe, setNovaEquipe] = useState(false);
  const [escalando, setEscalando] = useState<string | null>(null);
  const [substituindo, setSubstituindo] = useState<{
    equipeId: string;
    id: string;
    valor: number;
    tipo: TipoValor;
  } | null>(null);
  const rotacionarFn = useServerFn(rotacionarQrEvento);
  const sincronizarFn = useServerFn(sincronizarPontoEvento);

  const sincronizacaoPonto = useQuery({
    queryKey: ["sincronizar-ponto", eventoId],
    queryFn: () => sincronizarFn({ data: { eventoId } }),
    staleTime: 60_000,
  });

  const mudarStatus = useMutation({
    mutationFn: async ({ novo, manual = true }: { novo: StatusEvento; manual?: boolean }) => {
      const atual = evento.data!.status;
      const erro = validarTransicao(atual, novo, { permitirManual: manual });
      if (erro) throw new Error(erro);
      const { error } = await supabase.from("eventos").update({ status: novo }).eq("id", eventoId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["evento", eventoId] });
      queryClient.invalidateQueries({ queryKey: ["eventos"] });
      toast.success(`Etapa atualizada para "${ROTULO_STATUS_EVENTO[vars.novo]}".`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mudarEscala = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "confirmado" | "recusado" }) => {
      const { error } = await supabase
        .from("escalas")
        .update({
          status,
          confirmado_em: status === "confirmado" ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["equipes", eventoId] });
      if (evento.data?.status === "confirmacoes" && equipes.data) {
        const todas = equipes.data.flatMap((q) => q.escalas ?? []);
        const total = todas.length;
        const confirmadas = todas.filter((x) => x.status === "confirmado").length;
        if (total > 0 && confirmadas + 1 >= total) {
          try {
            await supabase.from("eventos").update({ status: "pronto" }).eq("id", eventoId);
            queryClient.invalidateQueries({ queryKey: ["evento", eventoId] });
            queryClient.invalidateQueries({ queryKey: ["eventos"] });
            toast.success(
              "Todas as confirmações recebidas! Evento avançou automaticamente para 'Pronto'.",
            );
          } catch {
            // segue
          }
        }
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rotacionarQr = useMutation({
    mutationFn: () => rotacionarFn({ data: { eventoId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["evento", eventoId] });
      queryClient.invalidateQueries({ queryKey: ["painel"] });
      queryClient.invalidateQueries({ queryKey: ["sincronizar-ponto", eventoId] });
      queryClient.refetchQueries({ queryKey: ["evento", eventoId] });
      queryClient.refetchQueries({ queryKey: ["sincronizar-ponto", eventoId] });
      toast.success("Novo QR Code gerado e ativado por 12 horas.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Avaliação contínua de auto-avanço conforme dados da montagem e datas
  useEffect(() => {
    if (!evento.data || !equipes.data) return;
    const todasEscalas = equipes.data.flatMap((eq) => eq.escalas ?? []);
    const confirmadas = todasEscalas.filter((es) => es.status === "confirmado").length;
    const sugestao = calcularStatusSugeridoEvento({
      statusAtual: evento.data.status,
      totalEquipes: equipes.data.length,
      totalEscalas: todasEscalas.length,
      escalasConfirmadas: confirmadas,
      dataInicioIso: evento.data.data_inicio,
      dataFimIso: evento.data.data_fim,
    });

    if (sugestao.mudou) {
      void supabase
        .from("eventos")
        .update({ status: sugestao.statusSugerido })
        .eq("id", eventoId)
        .then(({ error }) => {
          if (!error) {
            queryClient.invalidateQueries({ queryKey: ["evento", eventoId] });
            queryClient.invalidateQueries({ queryKey: ["eventos"] });
            toast.info(
              `Status avançou automaticamente para "${ROTULO_STATUS_EVENTO[sugestao.statusSugerido]}" (${sugestao.motivo})`,
            );
          }
        });
    }
  }, [evento.data, equipes.data, eventoId, queryClient]);

  if (evento.isPending) {
    return (
      <AppShell titulo="Evento">
        <LoadingBloco />
      </AppShell>
    );
  }
  if (evento.isError) {
    return (
      <AppShell titulo="Evento">
        <ErrorState error={evento.error} onRetry={() => evento.refetch()} />
      </AppShell>
    );
  }

  const e = evento.data;
  const proximo = proximoStatus(e.status);
  const anterior = statusAnterior(e.status);
  const tokenAtivo = e.qr_code_token || sincronizacaoPonto.data?.signedToken;
  const urlPonto =
    typeof window !== "undefined" ? `${window.location.origin}/ponto/${tokenAtivo}` : "";

  return (
    <AppShell
      titulo={e.nome}
      descricao={`${dataHora(e.data_inicio)}${e.local ? ` · ${e.local}` : ""}${
        e.clientes?.nome ? ` · ${e.clientes.nome}` : ""
      }`}
      acoes={
        <div className="flex flex-wrap items-center gap-2">
          {anterior ? (
            <Button
              size="sm"
              variant="outline"
              disabled={mudarStatus.isPending}
              onClick={() => mudarStatus.mutate({ novo: anterior, manual: true })}
            >
              <ArrowLeft className="size-3.5 mr-1" />
              <span>Voltar para {ROTULO_STATUS_EVENTO[anterior]}</span>
            </Button>
          ) : null}

          {proximo ? (
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs"
              disabled={mudarStatus.isPending}
              onClick={() => mudarStatus.mutate({ novo: proximo, manual: true })}
            >
              <span>Avançar para {ROTULO_STATUS_EVENTO[proximo]}</span>
              <ArrowRight className="size-3.5 ml-1" />
            </Button>
          ) : null}

          {podeCancelar(e.status) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={mudarStatus.isPending}
              onClick={() => mudarStatus.mutate({ novo: "cancelado", manual: true })}
            >
              <Ban className="size-3.5 mr-1" /> Cancelar
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="mb-5 flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <StatusBadge status={e.status} />
          {ehEtapaFinalizacao(e.status) ? (
            <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-950 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-900">
              Etapa de Finalização Manual
            </span>
          ) : (
            <span className="text-[11px] font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-200/60 dark:border-amber-900/40">
              Montagem Automática
            </span>
          )}
        </div>
        <Stepper
          atual={e.status}
          onMudarStatus={(novo) => mudarStatus.mutate({ novo, manual: true })}
          carregando={mudarStatus.isPending}
        />
      </div>

      <Tabs defaultValue="equipes">
        <TabsList>
          <TabsTrigger value="equipes">Equipes e escala</TabsTrigger>
          <TabsTrigger value="ponto">QR Code de ponto</TabsTrigger>
        </TabsList>

        <TabsContent value="equipes" className="space-y-4">
          <Button size="sm" variant="outline" onClick={() => setNovaEquipe(true)}>
            <Plus className="size-4" /> Nova equipe
          </Button>

          {equipes.isPending ? (
            <LoadingBloco />
          ) : equipes.isError ? (
            <ErrorState error={equipes.error} onRetry={() => equipes.refetch()} />
          ) : equipes.data.length === 0 ? (
            <EmptyState
              titulo="Nenhuma equipe"
              descricao="Crie uma equipe para escalar os freelancers."
            />
          ) : (
            equipes.data.map((q) => (
              <section key={q.id} className="rounded-md border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold">{q.nome}</h2>
                    <p className="text-xs text-muted-foreground">
                      Supervisor: {q.usuarios?.nome ?? "não definido"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setEscalando(q.id)}>
                    <UserPlus className="size-4" /> Escalar
                  </Button>
                </div>
                {q.escalas.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Ninguém escalado nesta equipe.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {q.escalas.map((es) => (
                      <li
                        key={es.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{es.freelancers?.nome}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {moeda(es.valor_combinado)} · {ROTULO_TIPO_VALOR[es.tipo_valor]}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={es.status} />
                          {es.status === "convidado" ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  mudarEscala.mutate({ id: es.id, status: "confirmado" })
                                }
                              >
                                Confirmar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  mudarEscala.mutate({ id: es.id, status: "recusado" })
                                }
                              >
                                Recusar
                              </Button>
                            </>
                          ) : null}
                          {es.status === "recusado" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setSubstituindo({
                                  equipeId: q.id,
                                  id: es.id,
                                  valor: Number(es.valor_combinado),
                                  tipo: es.tipo_valor,
                                })
                              }
                            >
                              Substituir
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))
          )}
        </TabsContent>

        <TabsContent value="ponto">
          <div className="flex flex-col items-start gap-4 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center">
            <div className="rounded-md bg-white p-3">
              {urlPonto ? <QRCodeSVG value={urlPonto} size={148} /> : null}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">QR Code de ponto deste evento</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A equipe registra entrada, intervalo e saída lendo este código e informando o CPF.
              </p>
              <p className="mt-2 break-all text-xs text-muted-foreground">{urlPonto}</p>
              {e.qr_code_expira_em ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Válido até {dataHora(e.qr_code_expira_em)}.
                </p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(urlPonto);
                    toast.success("Link copiado.");
                  }}
                >
                  Copiar link
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/operacao/$eventoId" params={{ eventoId }}>
                    Painel de operação
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rotacionarQr.isPending}
                  onClick={() => rotacionarQr.mutate()}
                >
                  <RefreshCw className="size-4" /> Trocar QR
                </Button>
              </div>

              {typeof window !== "undefined" &&
              (window.location.hostname === "localhost" ||
                window.location.hostname === "127.0.0.1") ? (
                <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                  <p className="font-semibold">Aviso de teste local (localhost):</p>
                  <p className="mt-0.5 leading-relaxed">
                    Você está no computador em <code>localhost</code>. Para escanear o QR Code no
                    celular, acesse este painel pelo IP da sua rede (ex:{" "}
                    <code>http://192.168.x.x:3000</code>) ou pelo link público da sua publicação na
                    Vercel.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={novaEquipe} onOpenChange={setNovaEquipe}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova equipe</DialogTitle>
          </DialogHeader>
          <FormEquipe
            eventoId={eventoId}
            eventoStatus={e.status}
            onFechar={() => setNovaEquipe(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(escalando)} onOpenChange={(o) => !o && setEscalando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escalar freelancer</DialogTitle>
          </DialogHeader>
          {escalando ? (
            <FormEscala
              eventoId={eventoId}
              equipeId={escalando}
              eventoStatus={e.status}
              onFechar={() => setEscalando(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(substituindo)} onOpenChange={(o) => !o && setSubstituindo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Substituir freelancer</DialogTitle>
          </DialogHeader>
          {substituindo ? (
            <FormEscala
              eventoId={eventoId}
              equipeId={substituindo.equipeId}
              eventoStatus={e.status}
              substituindo={substituindo}
              onFechar={() => setSubstituindo(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
