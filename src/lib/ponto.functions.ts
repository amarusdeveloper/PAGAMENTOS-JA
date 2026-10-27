import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenSchema = z.object({ token: z.string().min(8).max(128) });

const identificarSchema = tokenSchema.extend({
  cpf: z.string().regex(/^\d{11}$/, "CPF deve ter 11 dígitos"),
});

const registrarSchema = identificarSchema.extend({
  escalaId: z.string().uuid(),
  tipo: z.enum(["entrada", "saida", "inicio_intervalo", "fim_intervalo"]),
  fotoBase64: z.string().max(4_000_000).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  consentiuSelfie: z.boolean().optional(),
});

const contextoSchema = z.object({
  pontoBasico: z.boolean(),
  evento: z.object({
    id: z.string().optional(),
    nome: z.string(),
    local: z.string().nullable(),
    status: z.string().nullable(),
    data_inicio: z.string(),
    data_fim: z.string().nullable(),
    qr_code_expira_em: z.string().nullable(),
  }),
  exigeSelfie: z.boolean(),
  exigeGps: z.boolean(),
});

const identificacaoResultSchema = z.object({
  escalaId: z.string().uuid(),
  statusEscala: z.string(),
  nome: z.string(),
  pontos: z.array(
    z.object({
      id: z.string().uuid(),
      tipo: z.string(),
      registrado_em: z.string(),
      status: z.string(),
      fora_horario: z.boolean(),
    }),
  ),
});

async function invokePontoEdge<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { createSupabasePublicClient } = await import("@/integrations/supabase/public.server");
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.functions.invoke("ponto-publico", { body });
  if (error) {
    console.error("[Ponto público] Falha ao chamar Supabase Edge Function:", error);
    let detalhe = error.message;
    if (error.context instanceof Response) {
      const body: unknown = await error.context.clone().json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        detalhe = body.error;
      }
    }
    throw new Error(
      `Não foi possível acessar o serviço de ponto. Confira a chave pública e a implantação da Edge Function: ${detalhe}`,
    );
  }
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    throw new Error(data.error);
  }
  return schema.parse(data);
}

/** Contexto público mínimo do evento a partir do token do QR Code. */
export const obterContextoPonto = createServerFn({ method: "GET" })
  .validator((input: unknown) => tokenSchema.parse(input))
  .handler(({ data }) =>
    invokePontoEdge({ action: "contexto", token: data.token }, contextoSchema),
  );

/** Identifica o freelancer pelo CPF e devolve as marcações já registradas. */
export const identificarNoPonto = createServerFn({ method: "POST" })
  .validator((input: unknown) => identificarSchema.parse(input))
  .handler(({ data }) =>
    invokePontoEdge({ action: "identificar", ...data }, identificacaoResultSchema),
  );

/** Confirma a presença na escala a partir do celular do freelancer. */
export const confirmarPresenca = createServerFn({ method: "POST" })
  .validator((input: unknown) => identificarSchema.parse(input))
  .handler(({ data }) =>
    invokePontoEdge({ action: "confirmar", ...data }, z.object({ ok: z.literal(true) })),
  );

/** Registra entrada, intervalo ou saída. A marcação fica pendente de revisão. */
export const registrarPonto = createServerFn({ method: "POST" })
  .validator((input: unknown) => registrarSchema.parse(input))
  .handler(({ data }) =>
    invokePontoEdge(
      { action: "registrar", ...data },
      z.object({ ok: z.literal(true), foraHorario: z.boolean() }),
    ),
  );
