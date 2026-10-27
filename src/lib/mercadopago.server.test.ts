import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AssinaturaBloqueadaError,
  consultarAssinaturaMercadoPagoApi,
  limparCacheAssinatura,
} from "./mercadopago.server";

describe("Mercado Pago — Verificação de Assinatura e Bloqueio de Funcionalidades", () => {
  beforeEach(() => {
    limparCacheAssinatura();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    limparCacheAssinatura();
    vi.restoreAllMocks();
  });

  describe("consultarAssinaturaMercadoPagoApi", () => {
    it("deve aprovar acesso quando assinatura estiver com status 'authorized'", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              id: "preapproval_12345",
              status: "authorized",
              payer_email: "cliente@agencia.com.br",
              reason: "Plano Pro Já",
              auto_recurring: {
                transaction_amount: 299.0,
              },
              next_payment_date: "2026-11-26T00:00:00.000Z",
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const resultado = await consultarAssinaturaMercadoPagoApi({
        accessToken: "TEST_TOKEN_123",
        empresaId: "empresa-abc",
      });

      expect(resultado.bloqueado).toBe(false);
      expect(resultado.pago).toBe(true);
      expect(resultado.status).toBe("ativo");
      expect(resultado.subscriptionId).toBe("preapproval_12345");
      expect(resultado.valor).toBe(299.0);
    });

    it("deve bloquear funcionalidades quando assinatura estiver com status 'pending'", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              id: "preapproval_pendente_999",
              status: "pending",
              auto_recurring: {
                transaction_amount: 199.0,
              },
            },
          ],
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const resultado = await consultarAssinaturaMercadoPagoApi({
        accessToken: "TEST_TOKEN_123",
        empresaId: "empresa-pendente",
      });

      expect(resultado.bloqueado).toBe(true);
      expect(resultado.pago).toBe(false);
      expect(resultado.status).toBe("pendente");
      expect(resultado.motivo).toContain("pendente");
    });

    it("deve bloquear funcionalidades quando assinatura estiver pausada/vencida ('paused')", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: "preapproval_vencida_888",
          status: "paused",
          transaction_amount: 399.0,
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const resultado = await consultarAssinaturaMercadoPagoApi({
        accessToken: "TEST_TOKEN_123",
        subscriptionId: "preapproval_vencida_888",
        empresaId: "empresa-vencida",
      });

      expect(resultado.bloqueado).toBe(true);
      expect(resultado.pago).toBe(false);
      expect(resultado.status).toBe("vencido");
      expect(resultado.motivo).toContain("suspensa por falta de pagamento");
    });

    it("deve bloquear funcionalidades quando assinatura estiver cancelada ('cancelled')", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: "preapproval_cancelada_777",
          status: "cancelled",
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const resultado = await consultarAssinaturaMercadoPagoApi({
        accessToken: "TEST_TOKEN_123",
        subscriptionId: "preapproval_cancelada_777",
        empresaId: "empresa-cancelada",
      });

      expect(resultado.bloqueado).toBe(true);
      expect(resultado.pago).toBe(false);
      expect(resultado.status).toBe("cancelado");
      expect(resultado.motivo).toContain("cancelada");
    });

    it("deve bloquear com status vencido quando API retornar 404 (assinatura inexistente)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      });
      vi.stubGlobal("fetch", mockFetch);

      const resultado = await consultarAssinaturaMercadoPagoApi({
        accessToken: "TEST_TOKEN_123",
        subscriptionId: "inexistente",
        empresaId: "empresa-sem-assinatura",
      });

      expect(resultado.bloqueado).toBe(true);
      expect(resultado.status).toBe("vencido");
    });
  });

  describe("AssinaturaBloqueadaError", () => {
    it("deve instanciar erro tipado com código ASSINATURA_PAGAMENTO_BLOQUEADO", () => {
      const erro = new AssinaturaBloqueadaError("Mensagem de teste", {
        status: "vencido",
        motivo: "Fatura em atraso",
        empresaId: "empresa-123",
      });

      expect(erro.name).toBe("AssinaturaBloqueadaError");
      expect(erro.codigo).toBe("ASSINATURA_PAGAMENTO_BLOQUEADO");
      expect(erro.status).toBe("vencido");
      expect(erro.motivo).toBe("Fatura em atraso");
      expect(erro.empresaId).toBe("empresa-123");
      expect(erro.message).toBe("Mensagem de teste");
    });
  });
});
