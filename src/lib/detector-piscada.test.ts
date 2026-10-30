import { describe, expect, it, vi } from "vitest";

import { calcularEar, distanciaEuclidiana, MaquinaPiscadas } from "./detector-piscada";

const PASSO = 33; // ~30 fps

function criar() {
  const ev = { onPiscada: vi.fn(), onReset: vi.fn(), onCapturaPronta: vi.fn(), onEstado: vi.fn() };
  const m = new MaquinaPiscadas({}, ev);
  const clock = { t: 1000 };
  const fase = (fechamento: number, ms: number, rostoOk = true, min = fechamento) => {
    for (let i = 0; i < Math.max(1, Math.round(ms / PASSO)); i++) {
      clock.t += PASSO;
      m.processar({ t: clock.t, rostoOk, fechamento, fechamentoMin: min });
    }
  };
  const aberto = (ms: number) => fase(0.05, ms);
  const piscar = (ms = 120) => {
    fase(0.4, PASSO); // fechando (zona intermediária)
    fase(0.9, ms);
    fase(0.4, PASSO); // reabrindo (ainda acima do limiar de abertura)
    fase(0.05, PASSO * 2);
  };
  return { m, ev, fase, aberto, piscar };
}

describe("MaquinaPiscadas", () => {
  it("calcula distância euclidiana e EAR corretamente", () => {
    expect(distanciaEuclidiana({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    const p1 = { x: -10, y: 0 };
    const p2 = { x: -5, y: 3 };
    const p3 = { x: 5, y: 3 };
    const p4 = { x: 10, y: 0 };
    const p5 = { x: 5, y: -3 };
    const p6 = { x: -5, y: -3 };
    expect(calcularEar(p1, p2, p3, p4, p5, p6)).toBeCloseTo(0.3, 2);
  });

  it("só aceita piscadas depois de estabilizar o rosto", () => {
    const { m, aberto, piscar } = criar();
    aberto(200);
    piscar(); // cedo demais
    expect(m.snapshot().estado).toBe("ESTABILIZANDO");
    expect(m.snapshot().contagem).toBe(0);
  });

  it("1 piscada → 1/2, sem reset, e fica esperando a 2ª", () => {
    const { m, ev, aberto, piscar } = criar();
    aberto(800);
    expect(m.snapshot().estado).toBe("PISQUE_1");
    piscar();
    expect(m.snapshot()).toMatchObject({ estado: "PISQUE_2", contagem: 1 });
    aberto(2500);
    expect(m.snapshot()).toMatchObject({ estado: "PISQUE_2", contagem: 1 });
    expect(ev.onReset).not.toHaveBeenCalled();
  });

  it("2 piscadas → CAPTURANDO → SUCESSO só com olhos abertos", () => {
    const { m, ev, aberto, piscar } = criar();
    aberto(800);
    piscar();
    aberto(500);
    piscar();
    expect(m.snapshot().estado).toBe("CAPTURANDO");
    expect(ev.onCapturaPronta).not.toHaveBeenCalled();
    aberto(300);
    expect(m.snapshot().estado).toBe("SUCESSO");
    expect(ev.onCapturaPronta).toHaveBeenCalledTimes(1);
    expect(ev.onPiscada).toHaveBeenNthCalledWith(1, 1, expect.any(Number));
    expect(ev.onPiscada).toHaveBeenNthCalledWith(2, 2, expect.any(Number));
  });

  it("ruído na zona intermediária (histerese) não gera piscada", () => {
    const { m, aberto, fase } = criar();
    aberto(800);
    for (let i = 0; i < 40; i++) fase(i % 2 ? 0.45 : 0.3, PASSO); // oscila entre abrir e fechar, sem cruzar
    expect(m.snapshot().contagem).toBe(0);
    expect(m.snapshot().olhoFechado).toBe(false);
  });

  it("olhos fechados por 1,5 s não contam como piscada", () => {
    const { m, aberto, fase } = criar();
    aberto(800);
    fase(0.9, 1500);
    aberto(300);
    expect(m.snapshot().contagem).toBe(0);
  });

  it("piscada de um olho só (wink) é rejeitada", () => {
    const { m, aberto, fase } = criar();
    aberto(800);
    fase(0.6, 150, true, 0.1); // média alta, mas um olho aberto
    aberto(300);
    expect(m.snapshot().contagem).toBe(0);
  });

  it("perda curta do rosto (<400 ms) é ignorada; longa reseta", () => {
    const { m, ev, aberto, piscar, fase } = criar();
    aberto(800);
    piscar();
    fase(0, 200, false);
    expect(m.snapshot()).toMatchObject({ estado: "PISQUE_2", contagem: 1 });
    fase(0, 600, false);
    expect(m.snapshot().estado).toBe("AGUARDANDO_ROSTO");
    expect(ev.onReset).toHaveBeenCalledWith("rosto");
  });

  it("intervalo > 4 s entre piscadas reinicia com motivo 'intervalo'", () => {
    const { m, ev, aberto, piscar } = criar();
    aberto(800);
    piscar();
    aberto(4300);
    expect(m.snapshot()).toMatchObject({ estado: "PISQUE_1", contagem: 0 });
    expect(ev.onReset).toHaveBeenCalledWith("intervalo");
  });

  it("2ª piscada 1,5 s depois da 1ª funciona", () => {
    const { m, aberto, piscar } = criar();
    aberto(800);
    piscar();
    aberto(1500);
    piscar();
    expect(m.snapshot().estado).toBe("CAPTURANDO");
  });

  it("fechamento duplo em <100 ms (flicker) conta como UMA piscada", () => {
    const { m, aberto, fase } = criar();
    aberto(800);
    fase(0.9, 120);
    fase(0.1, PASSO); // reabre 1 frame
    fase(0.9, 120); // fecha de novo logo em seguida
    fase(0.05, 300);
    expect(m.snapshot().contagem).toBe(1);
  });
});
