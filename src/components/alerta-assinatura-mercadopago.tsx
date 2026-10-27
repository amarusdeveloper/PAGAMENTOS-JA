import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, AlertTriangle, ArrowRight, CreditCard } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { consultarStatusAssinaturaMercadoPago } from "@/lib/mercadopago.functions";

export function AlertaAssinaturaMercadoPago() {
  const { data: assinatura, isLoading } = useQuery({
    queryKey: ["assinatura-mercadopago-status"],
    queryFn: () => consultarStatusAssinaturaMercadoPago(),
    staleTime: 60_000,
  });

  if (isLoading || !assinatura || !assinatura.bloqueado) {
    return null;
  }

  const isVencido = assinatura.status === "vencido" || assinatura.status === "cancelado";

  if (isVencido) {
    return (
      <Alert
        variant="destructive"
        className="mb-6 border-red-500/50 bg-red-500/10 text-red-900 dark:text-red-200"
      >
        <AlertCircle className="size-5 text-red-600 dark:text-red-400" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
          <div>
            <AlertTitle className="font-bold flex items-center gap-2">
              <span>Assinatura Bloqueada por Pendência Financeira</span>
            </AlertTitle>
            <AlertDescription className="text-xs sm:text-sm mt-1 text-red-800 dark:text-red-300">
              {assinatura.motivo ??
                "O pagamento da sua assinatura no Mercado Pago está vencido. Funcionalidades operacionais (escalas, pontos e fechamentos) estão bloqueadas."}
            </AlertDescription>
          </div>
          <Button asChild size="sm" variant="destructive" className="shrink-0 font-semibold">
            <Link to="/plano" className="inline-flex items-center gap-1.5">
              <CreditCard className="size-4" />
              <span>Regularizar Pagamento</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </Alert>
    );
  }

  // Pendente
  return (
    <Alert className="mb-6 border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
      <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
        <div>
          <AlertTitle className="font-bold text-amber-900 dark:text-amber-300">
            Pagamento da Assinatura em Processamento
          </AlertTitle>
          <AlertDescription className="text-xs sm:text-sm mt-1 text-amber-800 dark:text-amber-400">
            {assinatura.motivo ??
              "O pagamento da sua mensalidade via Mercado Pago está pendente de confirmação. Assim que for compensado, o acesso completo será mantido."}
          </AlertDescription>
        </div>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="border-amber-500/40 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 shrink-0 font-medium"
        >
          <Link to="/plano" className="inline-flex items-center gap-1.5">
            <span>Ver Faturas</span>
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </Alert>
  );
}
