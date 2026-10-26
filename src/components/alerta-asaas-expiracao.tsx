import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, KeyRound } from "lucide-react";

import { obterStatusApiAsaas } from "@/lib/plataforma.functions";

export function AlertaAsaasExpiracao() {
  const consultarStatus = useServerFn(obterStatusApiAsaas);

  const q = useQuery({
    queryKey: ["admin", "asaas-status-expiracao"],
    queryFn: () => consultarStatus(),
    refetchInterval: 1000 * 60 * 30, // Recarrega a cada 30 minutos
  });

  if (q.isPending || q.isError || !q.data) {
    return null;
  }

  const {
    configurada,
    ambiente,
    diasRestantes,
    chaveMascarada,
    expirada,
    alertaUrgente,
    alertaAtencao,
  } = q.data;

  const urlAsaas =
    ambiente === "producao"
      ? "https://www.asaas.com/configuracoes/integracoes"
      : "https://sandbox.asaas.com/configuracoes/integracoes";

  let containerClass = "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200";
  let badgeClass = "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/60 dark:text-sky-300";
  let Icone = CheckCircle2;

  if (expirada) {
    containerClass = "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200";
    badgeClass = "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/60 dark:text-red-300";
    Icone = AlertCircle;
  } else if (alertaUrgente) {
    containerClass = "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200";
    badgeClass = "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/60 dark:text-rose-300";
    Icone = AlertTriangle;
  } else if (alertaAtencao) {
    containerClass = "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
    badgeClass = "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/60 dark:text-amber-300";
    Icone = AlertTriangle;
  }

  return (
    <div className={`mb-6 rounded-xl border p-4.5 shadow-sm transition-all ${containerClass}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg p-2 bg-white/60 dark:bg-black/20 shadow-xs">
            <KeyRound className="h-5 w-5 shrink-0" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-base leading-tight">
                Monitoramento da API Asaas (Pix & Cobranças)
              </h3>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>
                <Icone className="h-3 w-3" />
                {expirada
                  ? "Chave Expirada"
                  : alertaUrgente
                    ? `Expira em ${diasRestantes} dias (URGENTE)`
                    : alertaAtencao
                      ? `Expira em ${diasRestantes} dias`
                      : `Válida (${diasRestantes} dias restantes)`}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-300">
                {ambiente === "producao" ? "Ambiente: Produção" : "Ambiente: Sandbox"}
              </span>
            </div>

            <p className="mt-1.5 text-sm opacity-90 leading-relaxed">
              {expirada ? (
                <strong className="font-semibold text-red-700 dark:text-red-400">
                  ATENÇÃO: A chave de API do Asaas expirou em 31/12 às 00:00! Os envios de Pix aos freelancers e emissão de cobranças foram paralisados até a inserção da nova chave.
                </strong>
              ) : (
                <>
                  Esta chave de produção expira impreterivelmente em{" "}
                  <strong>31/12 às 00:00</strong>. Lembre-se de gerar uma nova chave no painel do Asaas antes do prazo para não interromper a operação financeira.
                </>
              )}
            </p>

            {configurada && chaveMascarada && (
              <div className="mt-2 text-xs font-mono opacity-80 flex items-center gap-1.5">
                <span>Chave ativa:</span>
                <code className="rounded bg-black/10 px-1.5 py-0.5 dark:bg-white/10 font-medium">
                  {chaveMascarada}
                </code>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 pt-1">
          <a
            href={urlAsaas}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-current/25 bg-white/80 px-3.5 py-2 text-xs font-medium shadow-xs transition-colors hover:bg-white dark:bg-black/30 dark:hover:bg-black/50"
          >
            <span>Gerar / Renovar Chave</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
