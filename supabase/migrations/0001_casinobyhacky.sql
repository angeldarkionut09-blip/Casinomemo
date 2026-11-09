-- CasinobyHacky (auto-core.ro/casinobyhacky): daily casino claim tracker, separate from AutoCore data.
-- Accounts store only a salt and a hash of a client-derived verifier; the password never reaches the server.
-- Each account's casino list is encrypted in the browser (AES-GCM) and stored here as opaque ciphertext.
-- Service-role only: the browser talks to these tables exclusively through /api/casinobyhacky/*.

CREATE TABLE IF NOT EXISTS public.casinobyhacky_accounts (
  username text PRIMARY KEY CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  salt text NOT NULL,
  verifier_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.casinobyhacky_sessions (
  token_hash text PRIMARY KEY,
  username text NOT NULL REFERENCES public.casinobyhacky_accounts (username) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS casinobyhacky_sessions_username_idx ON public.casinobyhacky_sessions (username);
CREATE INDEX IF NOT EXISTS casinobyhacky_sessions_expires_idx ON public.casinobyhacky_sessions (expires_at);

CREATE TABLE IF NOT EXISTS public.casinobyhacky_vaults (
  username text PRIMARY KEY REFERENCES public.casinobyhacky_accounts (username) ON DELETE CASCADE,
  iv text NOT NULL,
  ct text NOT NULL,
  updated_ms bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.casinobyhacky_accounts TO service_role;
GRANT ALL ON public.casinobyhacky_sessions TO service_role;
GRANT ALL ON public.casinobyhacky_vaults TO service_role;
ALTER TABLE public.casinobyhacky_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casinobyhacky_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casinobyhacky_vaults ENABLE ROW LEVEL SECURITY;
