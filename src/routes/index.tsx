import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  ExternalLink,
  QrCode,
  ShieldCheck,
  Sparkles,
  Users2,
  Wallet,
} from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { data } = await supabase.auth.getUser();
      if (data?.user) throw redirect({ to: "/painel" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
    }
  },
  head: () => ({
    meta: [
      { title: "Já — Gestão de Equipes e Pagamentos por Swali" },
      {
        name: "description",
        content:
          "SaaS corporativo B2B desenvolvido pela Swali para agências de eventos e produtoras: escalas, ponto por QR Code com selfie e GPS e Pix direto ao freelancer.",
      },
      {
        property: "og:title",
        content: "Já — Do primeiro convite ao Pix do freelancer, tudo no mesmo fluxo",
      },
      {
        property: "og:description",
        content:
          "Plataforma B2B para controle operacional de eventos, folha de ponto digital por QR Code com selfie e GPS, e fechamento financeiro com Pix em lote.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const RECURSOS = [
  {
    icone: CalendarDays,
    iconeGradiente: "from-cyan-400 to-blue-500",
    titulo: "Evento e escala integrada",
    descricao:
      "Monte equipes com supervisão, escale freelancers por diária ou por hora e controle confirmações em tempo real.",
  },
  {
    icone: QrCode,
    iconeGradiente: "from-blue-500 to-indigo-600",
    titulo: "Folha de ponto digital intuitiva",
    descricao:
      "Registro no celular por QR Code com selfie, localização GPS e validação para supervisores em campo.",
  },
  {
    icone: Wallet,
    iconeGradiente: "from-rose-500 to-amber-500",
    titulo: "Fechamento ágil e Pix direto",
    descricao:
      "Horas líquidas apuradas das batidas aprovadas, sem duplicidade, com quitação na chave Pix cadastrada.",
  },
];

function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        navigate({ to: "/painel", replace: true });
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        navigate({ to: "/painel", replace: true });
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50/70 via-slate-50/50 to-white text-slate-900 flex flex-col justify-between selection:bg-blue-100 selection:text-blue-900">
      <div>
        {/* Navigation Bar */}
        <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur-md sticky top-0 z-30">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-3.5">
            {/* Brand Logo & Swali Badge */}
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black tracking-tight text-slate-950">Já</span>
              <a
                href="https://www.swali.com.br/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/70 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100/70 hover:border-blue-300 transition-colors shadow-2xs"
                title="Conheça a Swali — Empresa desenvolvedora"
              >
                <Sparkles className="size-3 text-blue-600" />
                <span>Um produto Swali</span>
                <ExternalLink className="size-2.5 opacity-60" />
              </a>
            </div>

            {/* Top Navigation Links & Actions */}
            <div className="flex items-center gap-2.5">
              <Button
                asChild
                size="sm"
                variant="outline"
                className="border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium px-4 h-9 shadow-2xs"
              >
                <a href="https://www.swali.com.br/" target="_blank" rel="noreferrer">
                  Sobre a Swali
                </a>
              </Button>
              <Button
                asChild
                size="sm"
                className="bg-slate-950 text-white hover:bg-slate-800 font-medium px-4.5 h-9 shadow-xs"
              >
                <Link to="/auth">Entrar na plataforma</Link>
              </Button>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 pb-16 lg:pt-14 lg:pb-20">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-8 items-center">
            {/* Left Content */}
            <div className="lg:col-span-7">
              {/* Category Badge */}
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100/90 px-3.5 py-1 text-xs font-medium text-slate-700 shadow-2xs mb-6">
                <ShieldCheck className="size-3.5 text-blue-600" />
                <span>SaaS B2B para Agências de Eventos e Produtoras</span>
              </div>

              {/* Headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-[3.25rem] font-extrabold tracking-tight text-slate-950 leading-[1.12]">
                Do primeiro convite ao Pix do freelancer, tudo no mesmo fluxo.
              </h1>

              {/* Description */}
              <p className="mt-6 text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl">
                O <strong>Já — Gestão de Equipes e Pagamentos</strong> é a plataforma operacional
                desenvolvida pela{" "}
                <a
                  href="https://www.swali.com.br/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-900 underline decoration-blue-500 font-semibold hover:text-blue-600 transition-colors"
                >
                  Swali
                </a>{" "}
                para eliminar planilhas e mensagens soltas: monte escalas, colete pontos pelo
                celular e faça o fechamento financeiro com segurança jurídica e auditoria.
              </p>

              {/* Call to Actions */}
              <div className="mt-8 flex flex-wrap items-center gap-3.5">
                <Button
                  asChild
                  size="lg"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6.5 h-12 rounded-xl shadow-md hover:shadow-lg transition-all"
                >
                  <Link to="/auth" className="inline-flex items-center gap-2">
                    <span>Acessar agora</span>
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-slate-200 bg-white/90 hover:bg-slate-100 text-slate-800 font-medium px-6 h-12 rounded-xl shadow-2xs"
                >
                  <a
                    href="https://www.swali.com.br/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2"
                  >
                    <span>Conhecer soluções Swali</span>
                    <ExternalLink className="size-3.5 text-slate-400" />
                  </a>
                </Button>
              </div>
            </div>

            {/* Right Hero Visual Mockups */}
            <div className="lg:col-span-5 relative flex items-center justify-center">
              <div className="relative w-full max-w-[520px] lg:max-w-none">
                <img
                  src="/assets/aistudio/hero-mockup.webp"
                  alt="Demonstração visual da plataforma Já: escalas de eventos, ponto móvel com selfie e QR Code, e confirmação de Pix enviado"
                  className="w-full h-auto object-contain drop-shadow-2xl rounded-2xl"
                  loading="eager"
                />
              </div>
            </div>
          </div>

          {/* Features Grid (3 Cards) */}
          <div className="mt-16 grid gap-6 sm:grid-cols-3">
            {RECURSOS.map((r) => (
              <section
                key={r.titulo}
                className="rounded-2xl border border-slate-200/80 bg-white p-6.5 shadow-sm hover:shadow-md hover:border-blue-200 transition-all flex flex-col justify-between"
              >
                <div>
                  <div
                    className={`inline-flex size-11 items-center justify-center rounded-xl bg-gradient-to-br ${r.iconeGradiente} text-white shadow-xs`}
                  >
                    <r.icone className="size-5.5" aria-hidden />
                  </div>
                  <h2 className="mt-4.5 text-lg font-bold text-slate-900 tracking-tight">
                    {r.titulo}
                  </h2>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{r.descricao}</p>
                </div>
              </section>
            ))}
          </div>

          {/* Bottom Banner Highlight */}
          <div className="mt-12 rounded-2xl border border-slate-200/90 bg-slate-100/70 p-5 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xs">
            <div className="flex items-center gap-3.5">
              <div className="size-11 rounded-full bg-blue-100/90 flex items-center justify-center text-blue-700 shrink-0">
                <Users2 className="size-5.5" />
              </div>
              <div>
                <p className="text-sm sm:text-base font-bold text-slate-900">
                  Projetado para equipes de alto volume
                </p>
                <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                  Suporte simultâneo a modelos Freelancers (diária/hora) e funcionários CLT.
                </p>
              </div>
            </div>
            <a
              href="https://www.swali.com.br/"
              target="_blank"
              rel="noreferrer"
              className="text-xs sm:text-sm text-blue-600 font-semibold hover:text-blue-800 hover:underline inline-flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <span>Tecnologia Swali • saiba mais</span>
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200/70 bg-white py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            <p className="font-semibold text-slate-800">Já — Gestão de Equipes e Pagamentos</p>
            <p className="mt-0.5">
              Um produto corporativo oficial desenvolvido pela{" "}
              <a
                href="https://www.swali.com.br/"
                target="_blank"
                rel="noreferrer"
                className="text-slate-900 underline decoration-blue-500 font-semibold hover:text-blue-600 transition-colors"
              >
                Swali (swali.com.br)
              </a>
            </p>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://www.swali.com.br/"
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-900 transition-colors font-medium"
            >
              Sobre a Swali
            </a>
            <span>•</span>
            <span>Todos os direitos reservados</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
