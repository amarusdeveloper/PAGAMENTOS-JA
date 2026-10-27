-- ============================================================================
-- SCRIPT AUTO-CONTIDO E SEGURO PARA ATIVAR O PONTO DIGITAL E QR CODE NO SUPABASE
-- Pode ser executado repetidas vezes no SQL Editor sem nenhum erro de relação.
-- ============================================================================

-- 1. Garante que as colunas necessárias existam em eventos, pontos e configurações
ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS qr_code_gerado_em timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS qr_code_expira_em timestamp with time zone;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS selfie_retencao_dias integer NOT NULL DEFAULT 90;

ALTER TABLE public.pontos
  ADD COLUMN IF NOT EXISTS fora_horario boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_recusa text,
  ADD COLUMN IF NOT EXISTS selfie_consentimento_aceito_em timestamp with time zone,
  ADD COLUMN IF NOT EXISTS selfie_expira_em timestamp with time zone;

-- 2. Garante que as tabelas de rate limit e auditoria existam antes dos grants
CREATE TABLE IF NOT EXISTS public.tentativas_ponto_publico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  cpf_hash text,
  ip_hash text NOT NULL,
  acao text NOT NULL,
  sucesso boolean NOT NULL DEFAULT false,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auditoria_ponto_publico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  escala_id uuid REFERENCES public.escalas(id) ON DELETE SET NULL,
  ponto_id uuid REFERENCES public.pontos(id) ON DELETE SET NULL,
  acao text NOT NULL,
  resultado text NOT NULL,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

-- Ativa RLS nas tabelas
ALTER TABLE public.tentativas_ponto_publico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_ponto_publico ENABLE ROW LEVEL SECURITY;

-- 3. Mantém as tabelas de auditoria acessíveis apenas pelo servidor.
GRANT ALL ON public.tentativas_ponto_publico TO service_role, postgres;
GRANT ALL ON public.auditoria_ponto_publico TO service_role, postgres;
GRANT SELECT ON public.auditoria_ponto_publico TO authenticated;

-- Reverte permissões públicas amplas concedidas por versões anteriores deste script.
REVOKE ALL ON public.eventos, public.configuracoes, public.equipes,
  public.freelancers, public.escalas, public.pontos,
  public.tentativas_ponto_publico, public.auditoria_ponto_publico FROM anon;
DROP POLICY IF EXISTS "eventos_leitura_publica_por_qr" ON public.eventos;
DROP POLICY IF EXISTS "configuracoes_leitura_publica" ON public.configuracoes;
DROP POLICY IF EXISTS "tentativas_ponto_anon_insert" ON public.tentativas_ponto_publico;
DROP POLICY IF EXISTS "auditoria_ponto_anon_insert" ON public.auditoria_ponto_publico;

-- 4. RPC segura para ler somente o contexto mínimo de um QR Code.
CREATE OR REPLACE FUNCTION public.obter_contexto_ponto_por_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_evento record;
  v_config record;
  v_plano record;
BEGIN
  SELECT id, nome, local, status, empresa_id, data_inicio, data_fim, qr_code_expira_em
  INTO v_evento
  FROM public.eventos
  WHERE qr_code_token = _token;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT checkin_exige_selfie, checkin_exige_gps, selfie_retencao_dias
  INTO v_config
  FROM public.configuracoes
  WHERE empresa_id = v_evento.empresa_id;

  BEGIN
    SELECT * INTO v_plano FROM public.plano_da_empresa(v_evento.empresa_id);
  EXCEPTION WHEN OTHERS THEN
    v_plano := NULL;
  END;

  RETURN jsonb_build_object(
    'pontoBasico', COALESCE(v_plano.codigo = 'free', false),
    'evento', jsonb_build_object(
      'id', v_evento.id,
      'nome', v_evento.nome,
      'local', v_evento.local,
      'status', v_evento.status,
      'data_inicio', v_evento.data_inicio,
      'data_fim', v_evento.data_fim,
      'qr_code_expira_em', v_evento.qr_code_expira_em
    ),
    'exigeSelfie', COALESCE(v_config.checkin_exige_selfie, false),
    'exigeGps', COALESCE(v_config.checkin_exige_gps, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obter_contexto_ponto_por_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obter_contexto_ponto_por_token(text) TO anon, authenticated, service_role;
