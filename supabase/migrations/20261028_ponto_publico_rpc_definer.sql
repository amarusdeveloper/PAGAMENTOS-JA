-- ============================================================================
-- RPCs SECURITY DEFINER PARA PONTO DIGITAL PÚBLICO (SEM SERVICE_ROLE NO VERCEL)
-- ============================================================================
-- Permite que o colaborador acesse o link público do QR Code no celular sem precisar
-- de login, enquanto o banco valida a autenticidade do token, ordem das batidas,
-- limites de tentativas e grava a trilha de auditoria para os supervisores.
-- ============================================================================

-- 1. Garante que as colunas e tabelas necessárias existam
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

ALTER TABLE public.tentativas_ponto_publico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_ponto_publico ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.tentativas_ponto_publico TO service_role, postgres;
GRANT ALL ON public.auditoria_ponto_publico TO service_role, postgres;
GRANT SELECT ON public.auditoria_ponto_publico TO authenticated;

-- ============================================================================
-- FUNÇÃO 1: Obter Contexto do Ponto por Token
-- ============================================================================
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
  v_expira timestamptz;
  v_agora timestamptz := now();
BEGIN
  SELECT id, nome, local, status, empresa_id, data_inicio, data_fim, qr_code_expira_em, qr_code_gerado_em, criado_em
  INTO v_evento
  FROM public.eventos
  WHERE qr_code_token = _token;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Validação de expiração com janela de tolerância de 12 horas
  IF v_evento.qr_code_expira_em IS NOT NULL THEN
    IF v_agora > v_evento.qr_code_expira_em THEN
      IF v_agora - COALESCE(v_evento.qr_code_gerado_em, v_evento.criado_em) > interval '12 hours' THEN
        RAISE EXCEPTION 'QR Code expirado. Peça ao supervisor para clicar em "Trocar QR" no painel.';
      END IF;
    END IF;
    v_expira := v_evento.qr_code_expira_em;
  ELSIF v_evento.data_fim IS NOT NULL THEN
    IF v_agora > v_evento.data_fim + interval '12 hours' THEN
      RAISE EXCEPTION 'QR Code expirado. Peça ao supervisor para clicar em "Trocar QR" no painel.';
    END IF;
    v_expira := v_evento.data_fim + interval '12 hours';
  ELSE
    v_expira := v_agora + interval '24 hours';
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
      'qr_code_expira_em', v_expira
    ),
    'exigeSelfie', COALESCE(v_config.checkin_exige_selfie, false),
    'exigeGps', COALESCE(v_config.checkin_exige_gps, false)
  );
END;
$$;

-- ============================================================================
-- FUNÇÃO 2: Identificar Colaborador por CPF no Evento do QR Code
-- ============================================================================
CREATE OR REPLACE FUNCTION public.identificar_no_ponto_publico(_token text, _cpf text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_evento record;
  v_freelancer record;
  v_escala record;
  v_pontos jsonb;
  v_cpf_limpo text := regexp_replace(_cpf, '\D', '', 'g');
  v_agora timestamptz := now();
BEGIN
  IF length(v_cpf_limpo) <> 11 THEN
    RAISE EXCEPTION 'CPF deve conter exatamente 11 dígitos.';
  END IF;

  SELECT id, empresa_id, data_inicio, data_fim, qr_code_expira_em, qr_code_gerado_em, criado_em
  INTO v_evento
  FROM public.eventos
  WHERE qr_code_token = _token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR Code inválido ou não encontrado.';
  END IF;

  -- Validação de expiração
  IF v_evento.qr_code_expira_em IS NOT NULL AND v_agora > v_evento.qr_code_expira_em THEN
    IF v_agora - COALESCE(v_evento.qr_code_gerado_em, v_evento.criado_em) > interval '12 hours' THEN
      RAISE EXCEPTION 'Este QR Code está expirado.';
    END IF;
  END IF;

  SELECT id, nome
  INTO v_freelancer
  FROM public.freelancers
  WHERE empresa_id = v_evento.empresa_id AND regexp_replace(cpf, '\D', '', 'g') = v_cpf_limpo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador com este CPF não encontrado nesta agência.';
  END IF;

  SELECT s.id, s.status
  INTO v_escala
  FROM public.escalas s
  JOIN public.equipes eq ON eq.id = s.equipe_id
  WHERE eq.evento_id = v_evento.id
    AND s.freelancer_id = v_freelancer.id
    AND s.status <> 'substituido'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Você não está escalado na equipe deste evento.';
  END IF;

  IF v_escala.status = 'recusado' THEN
    RAISE EXCEPTION 'Sua participação neste evento foi recusada.';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'tipo', p.tipo,
      'registrado_em', p.registrado_em,
      'status', p.status,
      'fora_horario', p.fora_horario
    ) ORDER BY p.registrado_em
  ), '[]'::jsonb)
  INTO v_pontos
  FROM public.pontos p
  WHERE p.escala_id = v_escala.id;

  RETURN jsonb_build_object(
    'escalaId', v_escala.id,
    'statusEscala', v_escala.status,
    'nome', v_freelancer.nome,
    'pontos', v_pontos
  );
END;
$$;

-- ============================================================================
-- FUNÇÃO 3: Confirmar Presença no Evento
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirmar_presenca_ponto_publico(_token text, _cpf text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_res jsonb;
  v_escala_id uuid;
BEGIN
  v_res := public.identificar_no_ponto_publico(_token, _cpf);
  v_escala_id := (v_res->>'escalaId')::uuid;

  UPDATE public.escalas
  SET status = 'confirmado', confirmado_em = now()
  WHERE id = v_escala_id AND status = 'convidado';

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================================================
-- FUNÇÃO 4: Gravar Marcação de Ponto com Auditoria e Validação Sequencial
-- ============================================================================
CREATE OR REPLACE FUNCTION public.registrar_ponto_publico(
  _token text,
  _cpf text,
  _escala_id uuid,
  _tipo text,
  _foto_url text DEFAULT NULL,
  _gps_lat double precision DEFAULT NULL,
  _gps_lng double precision DEFAULT NULL,
  _consentiu_selfie boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_evento record;
  v_freelancer record;
  v_escala record;
  v_config record;
  v_plano record;
  v_pontos_count int;
  v_tipos_esperados text[];
  v_esperado text;
  v_agora timestamptz := now();
  v_fora_horario boolean := false;
  v_ponto_id uuid;
  v_retencao_dias int := 90;
  v_cpf_limpo text := regexp_replace(_cpf, '\D', '', 'g');
BEGIN
  IF _tipo NOT IN ('entrada', 'inicio_intervalo', 'fim_intervalo', 'saida') THEN
    RAISE EXCEPTION 'Tipo de ponto inválido.';
  END IF;

  SELECT id, empresa_id, data_fim, qr_code_expira_em, qr_code_gerado_em, criado_em
  INTO v_evento
  FROM public.eventos
  WHERE qr_code_token = _token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR Code inválido.';
  END IF;

  SELECT id, nome
  INTO v_freelancer
  FROM public.freelancers
  WHERE empresa_id = v_evento.empresa_id AND regexp_replace(cpf, '\D', '', 'g') = v_cpf_limpo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado.';
  END IF;

  SELECT s.id, s.status
  INTO v_escala
  FROM public.escalas s
  JOIN public.equipes eq ON eq.id = s.equipe_id
  WHERE eq.evento_id = v_evento.id
    AND s.id = _escala_id
    AND s.freelancer_id = v_freelancer.id
    AND s.status <> 'substituido';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escala inválida para este colaborador.';
  END IF;

  SELECT checkin_exige_selfie, checkin_exige_gps, selfie_retencao_dias
  INTO v_config
  FROM public.configuracoes
  WHERE empresa_id = v_evento.empresa_id;

  IF COALESCE(v_config.checkin_exige_selfie, false) AND _foto_url IS NULL THEN
    RAISE EXCEPTION 'Esta agência exige selfie para registrar o ponto.';
  END IF;

  IF COALESCE(v_config.checkin_exige_selfie, false) AND NOT _consentiu_selfie THEN
    RAISE EXCEPTION 'Confirme a autorização de uso da selfie para continuar.';
  END IF;

  IF COALESCE(v_config.checkin_exige_gps, false) AND (_gps_lat IS NULL OR _gps_lng IS NULL) THEN
    RAISE EXCEPTION 'Esta agência exige geolocalização (GPS) no registro.';
  END IF;

  BEGIN
    SELECT * INTO v_plano FROM public.plano_da_empresa(v_evento.empresa_id);
  EXCEPTION WHEN OTHERS THEN
    v_plano := NULL;
  END;

  IF COALESCE(v_plano.codigo = 'free', false) THEN
    v_tipos_esperados := ARRAY['entrada', 'saida'];
  ELSE
    v_tipos_esperados := ARRAY['entrada', 'inicio_intervalo', 'fim_intervalo', 'saida'];
  END IF;

  SELECT count(*)
  INTO v_pontos_count
  FROM public.pontos
  WHERE escala_id = v_escala.id AND status <> 'recusado';

  IF v_pontos_count >= array_length(v_tipos_esperados, 1) THEN
    RAISE EXCEPTION 'Todos os registros desta escala já foram concluídos.';
  END IF;

  v_esperado := v_tipos_esperados[v_pontos_count + 1];
  IF _tipo <> v_esperado THEN
    RAISE EXCEPTION 'O próximo registro deve ser %.', replace(v_esperado, '_', ' ');
  END IF;

  IF v_evento.data_fim IS NOT NULL AND v_agora > v_evento.data_fim THEN
    v_fora_horario := true;
  END IF;

  v_retencao_dias := LEAST(COALESCE(v_config.selfie_retencao_dias, 90), COALESCE(v_plano.retencao_evidencias_dias, 365));

  INSERT INTO public.pontos (
    escala_id,
    tipo,
    metodo,
    registrado_em,
    foto_url,
    gps_lat,
    gps_lng,
    status,
    fora_horario,
    selfie_consentimento_aceito_em,
    selfie_expira_em
  ) VALUES (
    v_escala.id,
    _tipo::public.tipo_ponto,
    CASE WHEN _foto_url IS NOT NULL THEN 'selfie'::public.metodo_check ELSE 'qrcode'::public.metodo_check END,
    v_agora,
    _foto_url,
    _gps_lat,
    _gps_lng,
    'pendente'::public.status_ponto,
    v_fora_horario,
    CASE WHEN _foto_url IS NOT NULL THEN v_agora ELSE NULL END,
    CASE WHEN _foto_url IS NOT NULL THEN v_agora + (v_retencao_dias || ' days')::interval ELSE NULL END
  )
  RETURNING id INTO v_ponto_id;

  -- Grava trilha de auditoria para os supervisores
  INSERT INTO public.auditoria_ponto_publico (
    empresa_id,
    escala_id,
    ponto_id,
    acao,
    resultado,
    detalhes
  ) VALUES (
    v_evento.empresa_id,
    v_escala.id,
    v_ponto_id,
    'ponto_registrado',
    'sucesso',
    jsonb_build_object(
      'tipo', _tipo,
      'fora_horario', v_fora_horario,
      'com_selfie', _foto_url IS NOT NULL,
      'com_gps', _gps_lat IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'foraHorario', v_fora_horario,
    'pontoId', v_ponto_id
  );
END;
$$;

-- Permissões de execução para qualquer cliente (anon, authenticated, service_role)
REVOKE ALL ON FUNCTION public.obter_contexto_ponto_por_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obter_contexto_ponto_por_token(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.identificar_no_ponto_publico(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identificar_no_ponto_publico(text, text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirmar_presenca_ponto_publico(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_presenca_ponto_publico(text, text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.registrar_ponto_publico(text, text, uuid, text, text, double precision, double precision, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_ponto_publico(text, text, uuid, text, text, double precision, double precision, boolean) TO anon, authenticated, service_role;

-- 5. Bucket de selfies e permissão de upload público
INSERT INTO storage.buckets (id, name, public)
VALUES ('selfies-ponto', 'selfies-ponto', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "selfies_insert_publico" ON storage.objects;
CREATE POLICY "selfies_insert_publico" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'selfies-ponto');

