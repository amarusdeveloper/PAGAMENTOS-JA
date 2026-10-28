import { describe, expect, it } from "vitest";
import { z } from "zod";

import { soDigitos } from "@/lib/dominio";
import { buscarSessaoEventoPorToken, salvarSessaoEvento } from "@/lib/ponto-store.server";
import { criarTokenQrCodeAssinado, decodificarTokenQrCode } from "@/lib/ponto.signed-token";
import { validarValidadeQr } from "@/lib/ponto.functions";

// Schemas e regras que espelham ponto.functions.ts e ponto.$token.tsx
const tokenSchema = z.object({ token: z.string().min(8).max(2048) });
const SEQUENCIA_PONTOS = ["entrada", "inicio_intervalo", "fim_intervalo", "saida"] as const;

function proximoPontoPermitido(ultimoTipo: string | null): string {
  if (!ultimoTipo) return "entrada";
  const idx = SEQUENCIA_PONTOS.indexOf(ultimoTipo as (typeof SEQUENCIA_PONTOS)[number]);
  if (idx < 0 || idx >= SEQUENCIA_PONTOS.length - 1) return "concluido";
  return SEQUENCIA_PONTOS[idx + 1] ?? "concluido";
}

function validarSequenciaPonto(tipoNovo: string, ultimoTipo: string | null): boolean {
  return proximoPontoPermitido(ultimoTipo) === tipoNovo;
}

function validarCoordenadasGps(lat?: number | null, lng?: number | null): boolean {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function validarEvidenciaSelfie(fotoBase64?: string | null): {
  valida: boolean;
  motivo?: string;
} {
  if (!fotoBase64) {
    return {
      valida: false,
      motivo: "Selfie é obrigatória como evidência visual para conferência humana.",
    };
  }
  if (!fotoBase64.startsWith("data:image/")) {
    return { valida: false, motivo: "Formato de imagem inválido." };
  }
  return { valida: true };
}

describe("Rotas de Ponto: /ponto.$token", () => {
  it("valida o formato do token de ponto suportando tokens regulares e assinados", () => {
    expect(() => tokenSchema.parse({ token: "token-valido-123" })).not.toThrow();
    expect(() => tokenSchema.parse({ token: "curto" })).toThrow();
    expect(() => tokenSchema.parse({ token: "a".repeat(2049) })).toThrow();
  });

  it("gera e decodifica tokens de QR Code assinados sem depender de RLS anônimo", () => {
    const evento = {
      id: "88c654a9-d041-4470-8730-253b8a17c5dd",
      empresa_id: "3324de83-0a62-4c09-a485-77055b0a940f",
      nome: "Festival de Música Ao Vivo",
      local: "Parque Ibirapuera, Portão 3",
      data_inicio: new Date().toISOString(),
      data_fim: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
      qr_code_token: "tok12345678",
    };

    const tokenAssinado = criarTokenQrCodeAssinado(evento, {
      exigeSelfie: true,
      exigeGps: true,
      pontoBasico: false,
    });

    expect(tokenAssinado.startsWith("qr.")).toBe(true);
    expect(() => tokenSchema.parse({ token: tokenAssinado })).not.toThrow();

    const decodificado = decodificarTokenQrCode(tokenAssinado);
    expect(decodificado).not.toBeNull();
    expect(decodificado?.eventoId).toBe(evento.id);
    expect(decodificado?.nome).toBe(evento.nome);
    expect(decodificado?.local).toBe(evento.local);
    expect(decodificado?.exigeSelfie).toBe(true);
    expect(decodificado?.exigeGps).toBe(true);
    expect(decodificado?.pontoBasico).toBe(false);
  });

  it("rejeita tokens assinados com assinatura adulterada", () => {
    const evento = {
      id: "88c654a9-d041-4470-8730-253b8a17c5dd",
      empresa_id: "3324de83-0a62-4c09-a485-77055b0a940f",
      nome: "Evento Teste",
      data_inicio: new Date().toISOString(),
    };
    const tokenAssinado = criarTokenQrCodeAssinado(evento);
    const adulterado = tokenAssinado.slice(0, -4) + "XXXX";
    expect(decodificarTokenQrCode(adulterado)).toBeNull();
  });

  it("armazena e localiza sessões de ponto no servidor por token regular e assinado", () => {
    const eventoId = "11111111-2222-3333-4444-555555555555";
    const qrCodeToken = "random_qr_token_teste_123";
    const signedToken = "qr.fake_payload.fake_sig";

    salvarSessaoEvento({
      eventoId,
      empresaId: "empresa-123",
      qrCodeToken,
      signedToken,
      nome: "Evento Convenção Anual",
      data_inicio: new Date().toISOString(),
      exigeSelfie: false,
      exigeGps: false,
      pontoBasico: false,
      escalas: [
        {
          escalaId: "escala-1",
          equipeId: "equipe-1",
          freelancerId: "freela-1",
          nome: "João Silva",
          cpf: "12345678901",
          status: "confirmado",
        },
      ],
      pontos: [],
      expiraEm: Date.now() + 12 * 60 * 60_000,
    });

    // Busca pelo token regular
    const sessaoPeloToken = buscarSessaoEventoPorToken(qrCodeToken);
    expect(sessaoPeloToken).not.toBeNull();
    expect(sessaoPeloToken?.eventoId).toBe(eventoId);
    expect(sessaoPeloToken?.escalas).toHaveLength(1);

    // Busca pelo token assinado
    const sessaoPeloAssinado = buscarSessaoEventoPorToken(signedToken);
    expect(sessaoPeloAssinado).not.toBeNull();
    expect(sessaoPeloAssinado?.nome).toBe("Evento Convenção Anual");
  });

  it("garante a ordem estrita das batidas de ponto em campo", () => {
    // 1. Primeira batida só pode ser entrada
    expect(validarSequenciaPonto("entrada", null)).toBe(true);
    expect(validarSequenciaPonto("saida", null)).toBe(false);
    expect(validarSequenciaPonto("inicio_intervalo", null)).toBe(false);

    // 2. Após entrada, o próximo é início do intervalo
    expect(validarSequenciaPonto("inicio_intervalo", "entrada")).toBe(true);
    expect(validarSequenciaPonto("saida", "entrada")).toBe(false);

    // 3. Após início do intervalo, o próximo é fim do intervalo
    expect(validarSequenciaPonto("fim_intervalo", "inicio_intervalo")).toBe(true);
    expect(validarSequenciaPonto("entrada", "inicio_intervalo")).toBe(false);

    // 4. Após fim do intervalo, o próximo é saída
    expect(validarSequenciaPonto("saida", "fim_intervalo")).toBe(true);
    expect(validarSequenciaPonto("inicio_intervalo", "fim_intervalo")).toBe(false);

    // 5. Após saída, sequência concluída
    expect(proximoPontoPermitido("saida")).toBe("concluido");
  });

  it("valida coordenadas geográficas do GPS em campo", () => {
    // Coordenadas válidas (ex: São Paulo)
    expect(validarCoordenadasGps(-23.55052, -46.633308)).toBe(true);
    // Coordenadas inválidas
    expect(validarCoordenadasGps(95, -46)).toBe(false);
    expect(validarCoordenadasGps(-23, 200)).toBe(false);
    expect(validarCoordenadasGps(null, null)).toBe(false);
  });

  it("enforça selfie como evidência para conferência humana e não prova biométrica", () => {
    const semFoto = validarEvidenciaSelfie(null);
    expect(semFoto.valida).toBe(false);
    expect(semFoto.motivo).toContain("conferência humana");

    const comFotoValida = validarEvidenciaSelfie("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...");
    expect(comFotoValida.valida).toBe(true);
  });

  it("normaliza CPF para identificação no ponto público", () => {
    expect(soDigitos("123.456.789-00")).toBe("12345678900");
    expect(soDigitos(" 123 456 789 00 ")).toBe("12345678900");
  });

  it("garante que eventos recém-criados tenham QR Code válido e não expirem imediatamente", () => {
    const agora = new Date();
    // 1. Evento recém-criado sem expiração nem fim preenchido é válido
    const expiraSemFim = validarValidadeQr({
      data_fim: null,
      qr_code_expira_em: null,
      criado_em: agora.toISOString(),
    });
    expect(new Date(expiraSemFim).getTime()).toBeGreaterThan(agora.getTime());

    // 2. Evento com qr_code_expira_em no futuro é válido
    const dataFutura = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const expiraFuturo = validarValidadeQr({
      data_fim: null,
      qr_code_expira_em: dataFutura,
    });
    expect(expiraFuturo).toBe(dataFutura);

    // 3. Evento recém-criado onde data_fim foi há 1h (ex: teste ou ajuste de horário) mantém janela de tolerância
    const fimPassado = new Date(Date.now() - 60 * 60_000).toISOString();
    const expiraRecente = validarValidadeQr({
      data_fim: fimPassado,
      qr_code_expira_em: null,
      criado_em: agora.toISOString(),
    });
    expect(new Date(expiraRecente).getTime()).toBeGreaterThan(agora.getTime());

    // 4. Evento antigo (ex: criado há 5 dias com expiração vencida) deve falhar
    const antigo = new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString();
    expect(() =>
      validarValidadeQr({
        data_fim: antigo,
        qr_code_expira_em: antigo,
        criado_em: antigo,
      }),
    ).toThrow(/expirado/);
  });
});
