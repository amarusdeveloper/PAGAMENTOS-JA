# Já — Gestão de Equipes e Pagamentos

[![CI](https://github.com/amarusdeveloper/PAGAMENTOS-JA/actions/workflows/ci.yml/badge.svg)](https://github.com/amarusdeveloper/PAGAMENTOS-JA/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![TanStack Start](https://img.shields.io/badge/TanStack_Start-1.121-orange.svg)](https://tanstack.com/start)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_RLS-3ecf8e.svg)](https://supabase.com/)
[![Tests](https://img.shields.io/badge/Tests-99_passing-brightgreen.svg)](docs/TESTES.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Plataforma corporativa B2B desenvolvida pela [Swali](https://www.swali.com.br/) para agências de eventos, produtoras e promotoras: monte escalas de equipe, colete folha de ponto digital em campo com selfie e geofencing GPS, faça o fechamento financeiro seguro e realize repasses via Pix no mesmo fluxo.**  
> Desenvolvido em **TypeScript Full-Stack**, **TanStack Start**, **React 19**, **PostgreSQL gerenciado (Supabase)**, **Drizzle ORM** e gateway financeiro **Asaas (v3)**.

---

## 📌 Visão Geral do Produto

Agências de casting, produtoras de eventos e empresas de terceirização enfrentam desafios operacionais e fiscais críticos no dia a dia:

1. **Fraudes em ponto de campo:** colaboradores que registram entrada sem estar no local ou compartilham links.
2. **Fechamento manual caótico:** conferência de horas, intervalos e diárias em planilhas manuais sujeitas a falhas.
3. **Confusão patrimonial e fiscal:** mistura entre os adiantamentos recebidos dos clientes contratantes (_funding_ em custódia de diárias) e a margem de receita própria da agência.
4. **Fricção bancária:** repasses individuais manuais via Pix para dezenas de profissionais ao término de cada escala.

A plataforma **Já** atua em um fluxo operacional unificado:

- **Ponto Digital em Campo:** check-in/out via celular do colaborador com leitura de QR Code dinâmico (expiração em 12h), geofencing por GPS (cálculo Haversine) e registro de selfie para conferência humana pelo supervisor.
- **Fechamento Operacional:** apuração de horas trabalhadas, horas extras e valor líquido com conferência em tela única e aprovação pelo coordenador.
- **Tesouraria com Segregação de Saldos:** separação contábil clara e isolada entre saldo real bancário, saldo aportado por clientes em custódia (_funding_) e receita de agência.
- **Repasses Pix e Webhooks:** integração com gateway bancário (Asaas API v3) com idempotência transacional contra duplicidade de créditos e monitoramento de expiração de credenciais.

---

## 🚀 Arquitetura e Stack Tecnológica

| Camada                    | Tecnologia                                                                         | Papel no Projeto                                                                          |
| :------------------------ | :--------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| **Full-Stack Framework**  | [TanStack Start](https://tanstack.com/start) + [React 19](https://react.dev/)      | SSR performante, type-safety de ponta a ponta e Server Functions executadas no servidor.  |
| **Linguagem**             | [TypeScript](https://www.typescriptlang.org/)                                      | Tipagem estrita com modo estrito de propriedades (`exactOptionalPropertyTypes`).          |
| **Banco de Dados & Auth** | [PostgreSQL (Supabase)](https://supabase.com/)                                     | Runtime de produção, Row Level Security (RLS) multi-tenant e autenticação GoTrue.         |
| **Schema as Code**        | [Drizzle ORM](https://orm.drizzle.team/)                                           | Definição declarativa de schemas (`drizzle/schema.ts`), migrações e tipagem de domínio.   |
| **Estilização & UI**      | [Tailwind CSS 4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) | Design system corporativo desenvolvido para alta densidade de informação operacional.     |
| **Gateway de Pagamento**  | [Asaas API v3](https://docs.asaas.com/)                                            | Cobranças e repasses Pix com suporte automático para ambientes de Sandbox e Produção.     |
| **Testes Automatizados**  | [Vitest](https://vitest.dev/)                                                      | 22 suítes e 99 testes cobrindo multi-tenancy, idempotência, tesouraria e regras de ponto. |
| **Hospedagem & Deploy**   | [Vercel](https://vercel.com/) / Docker                                             | Deploy nativo com suporte a SSR e rotas de API com pré-configuração em `vercel.json`.     |

---

## 📋 Funcionalidades Principais

| Módulo / Funcionalidade                  |     Status      | Detalhes                                                                                        |
| :--------------------------------------- | :-------------: | :---------------------------------------------------------------------------------------------- |
| **Landing Page Swali com Mockups**       | ✅ Implementado | Página inicial moderna para agências de eventos, com mockups ilustrativos e identidade Swali.   |
| **Monitoramento da API Asaas**           | ✅ Implementado | Alerta no painel Master com contagem regressiva para renovação da chave de integração.          |
| **Isolamento Multi-Tenant Estrito**      | ✅ Implementado | RLS em todas as tabelas de negócio; comprovado por testes automatizados de cross-tenant.        |
| **Ponto Mobile Antifraude**              | ✅ Implementado | QR Code com expiração de 12h, tolerância GPS Haversine e selfie para auditoria do supervisor.   |
| **Máquina de Estados de Marcações**      | ✅ Implementado | Sequência estrita `Entrada ➔ Início Intervalo ➔ Fim Intervalo ➔ Saída`; rejeição de duplicatas. |
| **Segregação de Saldos em Tesouraria**   | ✅ Implementado | Separação contábil entre adiantamento de clientes (_funding_ em custódia) e receita própria.    |
| **Faturamento SaaS V2**                  | ✅ Implementado | Planos por participações deduplicadas com precificação imutável congelada por ciclo.            |
| **Ingestão Idempotente de Webhooks**     | ✅ Implementado | Tabela `webhook_eventos` com hash determinístico e proteção contra duplo crédito.               |
| **Perfis e Acesso Suporte Auditado**     | ✅ Implementado | RBAC (`admin`, `coordenador`, `suporte`, `master`); suporte falha fechado sem ticket ativo.     |
| **Repasses Pix Integrados**              | ✅ Implementado | Disparo de Pix em lote e conferência financeira com liquidação na chave Pix do profissional.    |
| **Validação Cadastral Frela vs CLT**     | ✅ Implementado | Validações fiscais de CPF, PIS, chave Pix e separação de rotinas de cálculo.                    |
| **Suíte de Testes Automatizados**        | ✅ Implementado | 22 arquivos de teste e 99 testes automatizados com 100% de aprovação no Vitest.                 |
| **Pipeline de Integração Contínua (CI)** | ✅ Implementado | GitHub Actions com lint, typecheck, varredura de segredos e execução de testes.                 |
| **Deploy Nativo na Vercel**              | ✅ Implementado | Arquivo `vercel.json` configurado com rewrites adequados para TanStack Start / Nitro.           |

---

## 🛠️ Como Executar Localmente

### Pré-requisitos

- **Node.js 22+**
- **npm** (gerenciador oficial padronizado do projeto)

### 1. Clonar o Repositório

```bash
git clone https://github.com/amarusdeveloper/PAGAMENTOS-JA.git
cd PAGAMENTOS-JA
```

### 2. Instalar Dependências

```bash
npm install
```

### 3. Configurar Variáveis de Ambiente

Copie o arquivo de exemplo e configure suas chaves do Supabase e Asaas:

```bash
cp .env.example .env
```

### 4. Executar em Modo de Desenvolvimento

```bash
npm run dev
# Acesse no seu navegador: http://localhost:3000
```

---

## 🧪 Qualidade, Segurança e Testes

A integridade do código é mantida através de comandos padronizados:

```bash
# Executar todos os 99 testes automatizados (Vitest)
npm run test

# Verificação estática de tipos (TypeScript)
npm run typecheck

# Análise de padrões de código (ESLint)
npm run lint

# Varredura de segredos e conformidade com LGPD
npm run scan:secrets

# Formatação estrita com Prettier
npm run format

# Compilar para produção
npm run build
```

---

## 🚢 Como Implantar na Vercel

1. No painel da **[Vercel](https://vercel.com/)**, selecione o repositório `amarusdeveloper/PAGAMENTOS-JA`.
2. O framework preset será reconhecido automaticamente via `vercel.json`.
3. Nas **Environment Variables** da Vercel, adicione:
   - `SUPABASE_PROJECT_ID`: `rutmjtmirwcyoroyjqdy`
   - `SUPABASE_URL`: `https://rutmjtmirwcyoroyjqdy.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY`: _(sua chave publicável Supabase)_
   - `SUPABASE_SERVICE_ROLE_KEY`: _(chave `service_role` ou `sb_secret_`; somente servidor, nunca use prefixo `VITE_`)_
   - `VITE_SUPABASE_PROJECT_ID`: `rutmjtmirwcyoroyjqdy`
   - `VITE_SUPABASE_URL`: `https://rutmjtmirwcyoroyjqdy.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: _(sua chave publicável Supabase)_
   - `ASAAS_API_KEY`: _(sua chave de API de produção do Asaas)_
   - `ASAAS_AMBIENTE`: `producao`
   - `ASAAS_WEBHOOK_TOKEN`: _(seu token de validação de webhook)_
4. Execute `supabase/migrations/20261027_ponto_publico_policies.sql` no SQL Editor do projeto Supabase caso as migrações não sejam aplicadas automaticamente.
5. Garanta que `SUPABASE_SERVICE_ROLE_KEY` esteja habilitada para **Production** e faça um novo deploy após alterar variáveis de ambiente.

---

## 🔒 Segurança, LGPD e Auditoria de Segredos

- **Isolamento de Tenants:** O acesso a dados é blindado por RLS no banco de dados. Um tenant nunca consegue visualizar ou alterar registros de outra empresa.
- **Conformidade LGPD:** As fotos de ponto são utilizadas exclusivamente para conferência humana de identidade, coletadas com consentimento explícito e sujeitas a política de retenção temporal.
- **Zero Segredos no Código:** O repositório é auditado pelo script `scripts/scan-secrets.mjs`, garantindo que chaves privadas, senhas reais e CPFs verdadeiros nunca sejam comitados.

---

## 📄 Titularidade e Licença

**Já — Gestão de Equipes e Pagamentos** é uma plataforma corporativa SaaS B2B desenvolvida e operada pela **[Swali](https://www.swali.com.br/)**.  
Distribuído sob a licença [MIT](LICENSE).
