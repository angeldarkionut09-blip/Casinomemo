-- Citely (auto-core.ro/citely): daily casino claim tracker, separate from AutoCore data.
-- Accounts store only a salt and a hash of a client-derived verifier; the password never reaches the server.
-- Each account's casino list is encrypted in the browser (AES-GCM) and stored here as opaque ciphertext.
-- Service-role only: the browser talks to these tables exclusively through /api/citely/*.

CREATE TABLE IF NOT EXISTS public.citely_accounts (
  username text PRIMARY KEY CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  salt text NOT NULL,
  verifier_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.citely_sessions (
  token_hash text PRIMARY KEY,
  username text NOT NULL REFERENCES public.citely_accounts (username) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS citely_sessions_username_idx ON public.citely_sessions (username);
CREATE INDEX IF NOT EXISTS citely_sessions_expires_idx ON public.citely_sessions (expires_at);

CREATE TABLE IF NOT EXISTS public.citely_vaults (
  username text PRIMARY KEY REFERENCES public.citely_accounts (username) ON DELETE CASCADE,
  iv text NOT NULL,
  ct text NOT NULL,
  updated_ms bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.citely_accounts TO service_role;
GRANT ALL ON public.citely_sessions TO service_role;
GRANT ALL ON public.citely_vaults TO service_role;
ALTER TABLE public.citely_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citely_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citely_vaults ENABLE ROW LEVEL SECURITY;
