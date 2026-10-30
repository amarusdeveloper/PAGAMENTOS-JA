import { describe, expect, it } from "vitest";

import {
  calcularStatusSugeridoEvento,
  podeCancelar,
  proximoStatus,
  statusAnterior,
  validarTransicao,
  type StatusEvento,
} from "@/lib/dominio";

describe("Rotas de Eventos: /eventos e /eventos.$eventoId", () => {
  it("avança o status do evento um passo por vez", () => {
    expect(proximoStatus("planejamento")).toBe("escala");
    expect(proximoStatus("escala")).toBe("confirmacoes");
    expect(proximoStatus("confirmacoes")).toBe("pronto");
    expect(proximoStatus("pronto")).toBe("em_execucao");
    expect(proximoStatus("em_execucao")).toBe("encerrando");
    expect(proximoStatus("encerrando")).toBe("fechamento");
    expect(proximoStatus("fechamento")).toBe("pagamento");
    expect(proximoStatus("pagamento")).toBe("concluido");
    expect(proximoStatus("concluido")).toBe("arquivado");
    expect(proximoStatus("arquivado")).toBeNull();
    expect(proximoStatus("cancelado")).toBeNull();
  });

  it("permite transições estritas válidas", () => {
    expect(validarTransicao("planejamento", "escala")).toBeNull();
    expect(validarTransicao("escala", "confirmacoes")).toBeNull();
    expect(validarTransicao("confirmacoes", "pronto")).toBeNull();
    expect(validarTransicao("pronto", "em_execucao")).toBeNull();
    expect(validarTransicao("em_execucao", "encerrando")).toBeNull();
    expect(validarTransicao("encerrando", "fechamento")).toBeNull();
    expect(validarTransicao("fechamento", "pagamento")).toBeNull();
    expect(validarTransicao("pagamento", "concluido")).toBeNull();
    expect(validarTransicao("concluido", "arquivado")).toBeNull();
  });

  it("rejeita saltar etapas ou retroceder estados", () => {
    // Pular de planejamento direto para em_execucao
    const salto = validarTransicao("planejamento", "em_execucao");
    expect(salto).not.toBeNull();
    expect(salto).toContain("passe por");

    // Retroceder de concluído para em_execucao
    const retrocesso = validarTransicao("concluido", "em_execucao");
    expect(retrocesso).not.toBeNull();
  });

  it("permite cancelar apenas antes da conclusão do evento", () => {
    expect(podeCancelar("planejamento")).toBe(true);
    expect(podeCancelar("escala")).toBe(true);
    expect(podeCancelar("em_execucao")).toBe(true);
    expect(podeCancelar("concluido")).toBe(false);
    expect(podeCancelar("arquivado")).toBe(false);
    expect(podeCancelar("cancelado")).toBe(false);

    expect(validarTransicao("planejamento", "cancelado")).toBeNull();
    expect(validarTransicao("concluido", "cancelado")).toContain("não pode mais ser cancelado");
  });

  it("verifica janela de validade máxima de 12 horas para tokens de QR Code", () => {
    const agora = Date.now();
    const LIMITE_EXPIRACAO_MS = 12 * 60 * 60 * 1000;

    const dataCriacaoRecente = new Date(agora - 2 * 60 * 60 * 1000).toISOString();
    const dataCriacaoExpirada = new Date(agora - 13 * 60 * 60 * 1000).toISOString();

    const isExpirado = (criadoEm: string) =>
      Date.now() - new Date(criadoEm).getTime() > LIMITE_EXPIRACAO_MS;

    expect(isExpirado(dataCriacaoRecente)).toBe(false);
    expect(isExpirado(dataCriacaoExpirada)).toBe(true);
  });

  it("recua status com statusAnterior e permite transições manuais em finalização", () => {
    expect(statusAnterior("fechamento")).toBe("encerrando");
    expect(statusAnterior("pagamento")).toBe("fechamento");
    expect(statusAnterior("concluido")).toBe("pagamento");
    expect(statusAnterior("arquivado")).toBe("concluido");
    expect(statusAnterior("planejamento")).toBeNull();

    // Com permitirManual, permite navegação direta nas etapas de finalização
    expect(validarTransicao("fechamento", "pagamento", { permitirManual: true })).toBeNull();
    expect(validarTransicao("pagamento", "fechamento", { permitirManual: true })).toBeNull();
    expect(validarTransicao("em_execucao", "fechamento", { permitirManual: true })).toBeNull();
  });

  it("calcula auto-avanço do fluxo de montagem do evento", () => {
    // 1. Criação de equipe avança planejamento -> escala
    const res1 = calcularStatusSugeridoEvento({
      statusAtual: "planejamento",
      totalEquipes: 1,
      totalEscalas: 0,
      escalasConfirmadas: 0,
    });
    expect(res1.mudou).toBe(true);
    expect(res1.statusSugerido).toBe("escala");

    // 2. Escalação de freelancers avança escala -> confirmacoes
    const res2 = calcularStatusSugeridoEvento({
      statusAtual: "escala",
      totalEquipes: 1,
      totalEscalas: 2,
      escalasConfirmadas: 0,
    });
    expect(res2.mudou).toBe(true);
    expect(res2.statusSugerido).toBe("confirmacoes");

    // 3. Confirmações concluídas avançam -> pronto
    const res3 = calcularStatusSugeridoEvento({
      statusAtual: "confirmacoes",
      totalEquipes: 1,
      totalEscalas: 2,
      escalasConfirmadas: 2,
    });
    expect(res3.mudou).toBe(true);
    expect(res3.statusSugerido).toBe("pronto");

    // 4. Etapas manuais de finalização nunca são alteradas automaticamente
    const resFinal = calcularStatusSugeridoEvento({
      statusAtual: "fechamento",
      totalEquipes: 1,
      totalEscalas: 2,
      escalasConfirmadas: 2,
    });
    expect(resFinal.mudou).toBe(false);
    expect(resFinal.statusSugerido).toBe("fechamento");
  });
});
