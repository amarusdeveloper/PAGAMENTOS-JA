-- Migration: Permitir consulta pública anônima de eventos e ponto por token de QR Code
-- Permite que colaboradores/freelancers leiam os dados mínimos do evento sem login

-- 1. Concede permissão de SELECT para o perfil anon
GRANT SELECT ON public.eventos TO anon;
GRANT SELECT ON public.configuracoes TO anon;
GRANT SELECT ON public.equipes TO anon;
GRANT SELECT ON public.freelancers TO anon;
GRANT SELECT ON public.escalas TO anon;
GRANT SELECT, INSERT ON public.pontos TO anon;
GRANT SELECT, INSERT ON public.tentativas_ponto_publico TO anon;
GRANT SELECT, INSERT ON public.auditoria_ponto_publico TO anon;

-- 2. Políticas RLS para leitura pública do evento via token do QR Code
DROP POLICY IF EXISTS "eventos_leitura_publica_por_qr" ON public.eventos;
CREATE POLICY "eventos_leitura_publica_por_qr" ON public.eventos
  FOR SELECT TO anon
  USING (qr_code_token IS NOT NULL);

-- 3. Política RLS para leitura das configurações da empresa do evento
DROP POLICY IF EXISTS "configuracoes_leitura_publica" ON public.configuracoes;
CREATE POLICY "configuracoes_leitura_publica" ON public.configuracoes
  FOR SELECT TO anon
  USING (true);

-- 4. Função auxiliar de leitura segura do contexto de ponto (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.obter_contexto_ponto_por_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  SELECT * INTO v_plano FROM public.plano_da_empresa(v_evento.empresa_id);

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

GRANT EXECUTE ON FUNCTION public.obter_contexto_ponto_por_token(text) TO anon, authenticated, service_role;
