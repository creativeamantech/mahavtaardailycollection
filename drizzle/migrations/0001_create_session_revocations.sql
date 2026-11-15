CREATE TABLE public.app_session_revocations (
  token_hash text PRIMARY KEY,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT ALL ON TABLE public.app_session_revocations TO service_role;
ALTER TABLE public.app_session_revocations ENABLE ROW LEVEL SECURITY;
CREATE INDEX app_session_revocations_expires_at_idx ON public.app_session_revocations (expires_at);