import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { cadastrarOuRedefinirUsuario } from "@/lib/auth.functions";
import { carregarDadosAcesso, resolverDestinoAcesso } from "@/lib/auth-navigation";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        const dados = await carregarDadosAcesso(supabase, data.user.id);
        const destino = resolverDestinoAcesso(dados);
        if (destino !== "/auth") {
          throw redirect({ to: destino });
        }
      }
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
    }
  },
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "Entrar no Já — Gestão de Equipes e Pagamentos" },
      {
        name: "description",
        content:
          "Acesse o Já para gerenciar eventos, equipes, escalas, ponto em campo, fechamento de horas e pagamentos da sua agência.",
      },
      { property: "og:title", content: "Entrar no Já — Gestão de Equipes e Pagamentos" },
      {
        property: "og:description",
        content: "Acesso da agência ao painel de gestão de equipes e pagamento de colaboradores.",
      },
    ],
  }),
  component: Auth,
});

type ModoAuth = "login" | "cadastro" | "recuperar";

function Auth() {
  const navigate = useNavigate();
  const cadastrarOuRedefinir = useServerFn(cadastrarOuRedefinirUsuario);
  const [modo, setModo] = useState<ModoAuth>("login");
  const [carregando, setCarregando] = useState(false);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [recuperacaoEnviada, setRecuperacaoEnviada] = useState(false);

  const redirecionarParaDestino = useCallback(
    async (user: { id: string }) => {
      try {
        const dados = await carregarDadosAcesso(supabase, user.id);
        if (!dados.ativo) {
          toast.error("Conta desativada ou indisponível.");
          await supabase.auth.signOut();
          return;
        }
        const destino = resolverDestinoAcesso(dados);
        if (window.location.hash || window.location.search) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        try {
          await (navigate as unknown as (opts: { to: string; replace?: boolean }) => Promise<void>)(
            { to: destino, replace: true },
          );
        } catch {
          window.location.href = destino;
        }
      } catch (err) {
        console.error("Falha ao resolver destino de acesso:", err);
        window.location.href = "/painel";
      }
    },
    [navigate],
  );

  useEffect(() => {
    // 1. Trata código PKCE na query string (?code=...)
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (!error && data?.user) {
          toast.success("Autenticado com sucesso!");
          void redirecionarParaDestino(data.user);
        }
      });
    }

    // 2. Trata hash com tokens (#access_token=...&refresh_token=...)
    if (window.location.hash.includes("access_token=")) {
      const hash = window.location.hash.replace(/^#/, "");
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        supabase.auth
          .setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          .then(({ data, error }) => {
            if (!error && data?.user) {
              toast.success("Autenticado com sucesso!");
              void redirecionarParaDestino(data.user);
            }
          });
      }
    }

    // 3. Listener de estado de autenticação Supabase
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user && (event === "SIGNED_IN" || event === "USER_UPDATED")) {
        toast.success("Autenticado com sucesso!");
        await redirecionarParaDestino(session.user);
      }
    });

    // 4. Verificação de sessão já ativa no carregamento
    supabase.auth.getSession().then(async ({ data: sess }) => {
      if (sess.session?.user) {
        await redirecionarParaDestino(sess.session.user);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [redirecionarParaDestino]);

  // Handler: Fazer Login com Email e Senha
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      });

      if (error) {
        setCarregando(false);
        if (
          error.message.includes("Invalid login") ||
          error.message.includes("invalid_credentials")
        ) {
          toast.error("E-mail ou senha incorretos.");
        } else {
          toast.error(error.message);
        }
        return;
      }

      if (data?.user) {
        toast.success("Login realizado com sucesso!");
        await redirecionarParaDestino(data.user);
      }
    } catch (err) {
      setCarregando(false);
      toast.error(err instanceof Error ? err.message : "Erro ao efetuar login.");
    }
  }

  // Handler: Criar Nova Conta
  async function handleCadastro(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) {
      toast.error("Por favor, informe seu nome.");
      return;
    }
    if (senha.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres.");
      return;
    }

    setCarregando(true);
    try {
      const res = await cadastrarOuRedefinir({
        data: {
          email: email.trim(),
          password: senha,
          nome: nome.trim(),
        },
      });

      if (!res.sucesso) {
        setCarregando(false);
        toast.error(res.erro || "Falha ao processar cadastro.");
        return;
      }

      // Autentica imediatamente
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      });

      setCarregando(false);
      if (error) {
        toast.error("Conta criada! Por favor, faça login com sua senha.");
        setModo("login");
        return;
      }

      if (data?.user) {
        toast.success("Conta criada com sucesso! Bem-vindo ao Já.");
        await redirecionarParaDestino(data.user);
      }
    } catch (err) {
      setCarregando(false);
      toast.error(err instanceof Error ? err.message : "Erro inesperado ao cadastrar.");
    }
  }

  // Handler: Esqueci Minha Senha (Recuperação)
  async function handleRecuperarSenha(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Por favor, digite seu e-mail.");
      return;
    }

    setCarregando(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth`,
      });

      setCarregando(false);
      if (error) {
        toast.error(error.message || "Erro ao solicitar recuperação de senha.");
        return;
      }

      setRecuperacaoEnviada(true);
      toast.success("E-mail de recuperação enviado! Verifique sua caixa de entrada.");
    } catch (err) {
      setCarregando(false);
      toast.error("Erro inesperado ao solicitar recuperação.");
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-between bg-slate-50 dark:bg-slate-950 px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-md my-auto">
        {/* Cabeçalho da Marca */}
        <div className="mb-6 text-center space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-300">
            <ShieldCheck className="size-3.5 text-blue-600" />
            <span>SaaS Corporativo por Swali</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Já</h1>
          <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">
            Gestão de Equipes, Ponto e Pagamentos
          </p>
        </div>

        {/* Card Principal */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {/* 1. MODO: FAZER LOGIN */}
          {modo === "login" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Fazer login</h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Entre com seu e-mail e senha cadastrados.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs sm:text-sm font-medium">
                    E-mail
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="seu.email@empresa.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 text-base sm:text-sm rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="senha" className="text-xs sm:text-sm font-medium">
                      Senha
                    </Label>
                    <button
                      type="button"
                      onClick={() => {
                        setRecuperacaoEnviada(false);
                        setModo("recuperar");
                      }}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <Input
                    id="senha"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="h-11 text-base sm:text-sm rounded-xl"
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={carregando}
                  className="w-full h-11 sm:h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm sm:text-base shadow-sm transition-all"
                >
                  {carregando ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Entrando...</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <LogIn className="size-4" />
                      <span>Entrar no sistema</span>
                    </span>
                  )}
                </Button>
              </form>

              {/* Alternar para Cadastro */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
                <p className="text-xs sm:text-sm text-slate-500">
                  Ainda não tem uma conta?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setModo("cadastro");
                    }}
                    className="font-bold text-blue-600 hover:text-blue-700 hover:underline ml-1"
                  >
                    Criar conta
                  </button>
                </p>
              </div>
            </div>
          )}

          {/* 2. MODO: CRIAR CONTA */}
          {modo === "cadastro" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Criar conta</h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Cadastre sua agência e comece a gerenciar suas escalas.
                </p>
              </div>

              <form onSubmit={handleCadastro} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="nome" className="text-xs sm:text-sm font-medium">
                    Seu nome completo
                  </Label>
                  <Input
                    id="nome"
                    type="text"
                    required
                    placeholder="Ex: Carlos Eduardo"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="h-11 text-base sm:text-sm rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email-cad" className="text-xs sm:text-sm font-medium">
                    E-mail da agência ou corporativo
                  </Label>
                  <Input
                    id="email-cad"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="seu.email@empresa.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 text-base sm:text-sm rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="senha-cad" className="text-xs sm:text-sm font-medium">
                    Crie uma senha (mín. 6 caracteres)
                  </Label>
                  <Input
                    id="senha-cad"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="Mínimo de 6 dígitos"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="h-11 text-base sm:text-sm rounded-xl"
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={carregando}
                  className="w-full h-11 sm:h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm sm:text-base shadow-sm transition-all"
                >
                  {carregando ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span>Criando conta...</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <UserPlus className="size-4" />
                      <span>Criar conta e começar</span>
                    </span>
                  )}
                </Button>
              </form>

              {/* Alternar para Login */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
                <p className="text-xs sm:text-sm text-slate-500">
                  Já possui cadastro?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setModo("login");
                    }}
                    className="font-bold text-blue-600 hover:text-blue-700 hover:underline ml-1"
                  >
                    Fazer login
                  </button>
                </p>
              </div>
            </div>
          )}

          {/* 3. MODO: ESQUECI MINHA SENHA */}
          {modo === "recuperar" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  Esqueci minha senha
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Digite seu e-mail para receber as instruções de recuperação.
                </p>
              </div>

              {recuperacaoEnviada ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center space-y-3 dark:bg-emerald-950/40 dark:border-emerald-800">
                  <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-300">
                    <CheckCircle2 className="size-6" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                      Link enviado com sucesso!
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                      Verifique a caixa de entrada de <strong>{email}</strong> para redefinir sua
                      senha.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRecuperacaoEnviada(false);
                      setModo("login");
                    }}
                    className="w-full mt-2"
                  >
                    Voltar para o login
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleRecuperarSenha} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email-rec" className="text-xs sm:text-sm font-medium">
                      E-mail cadastrado
                    </Label>
                    <Input
                      id="email-rec"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="seu.email@empresa.com.br"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 text-base sm:text-sm rounded-xl"
                    />
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    disabled={carregando}
                    className="w-full h-11 sm:h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm sm:text-base shadow-sm transition-all"
                  >
                    {carregando ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        <span>Enviando...</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <Mail className="size-4" />
                        <span>Enviar link de recuperação</span>
                      </span>
                    )}
                  </Button>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setModo("login")}
                      className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    >
                      <ArrowLeft className="size-3.5" />
                      <span>Voltar para o login</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Rodapé Institucional */}
      <footer className="mt-8 text-center text-xs text-slate-400">
        <p>
          Já é uma plataforma corporativa desenvolvida pela{" "}
          <a
            href="https://www.swali.com.br/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-slate-600 dark:text-slate-300 underline hover:text-blue-600 transition-colors"
          >
            Swali (swali.com.br)
          </a>
        </p>
      </footer>
    </div>
  );
}
