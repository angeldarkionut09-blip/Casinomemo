/**
 * Citely API — accounts, sessions and the encrypted casino list (served at /citely/api/*).
 *
 * The browser derives a key from the password (PBKDF2) and sends only a verifier;
 * the server stores a hash of that verifier and never sees the password or the
 * decryption key. The casino list arrives already encrypted (AES-GCM) and is stored as-is.
 * Tables: citely_accounts, citely_sessions, citely_vaults (service-role only).
 */
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const VERIFIER_RE = /^[0-9a-f]{64}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const SESSION_DAYS = 30;
const MAX_FAILED = 10;
const LOCK_MINUTES = 15;
const MAX_CIPHERTEXT = 600_000; // ~450 KB of list data

type Json = Record<string, unknown>;

async function db(): Promise<SupabaseClient> {
  const { getDb } = await import("./db.js");
  return getDb();
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const json = (body: Json, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (message: string, status: number) => json({ message }, status);

function sameHash(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isB64(v: unknown, maxLen: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen && B64_RE.test(v);
}

async function readBody(request: Request): Promise<Json | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Json) : null;
  } catch {
    return null;
  }
}

async function createSession(client: SupabaseClient, username: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  const { error } = await client
    .from("citely_sessions")
    .insert({ token_hash: sha256(token), username, expires_at: expires });
  if (error) throw error;
  // opportunistic cleanup of this user's expired sessions
  await client
    .from("citely_sessions")
    .delete()
    .eq("username", username)
    .lt("expires_at", new Date().toISOString());
  return token;
}

async function sessionUser(client: SupabaseClient, request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.length > 200) return null;
  const { data } = await client
    .from("citely_sessions")
    .select("username, expires_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!data || new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return data.username as string;
}

/** Salt for a username; unknown names get a stable fake salt so accounts can't be enumerated. */
async function getSalt(client: SupabaseClient, url: URL) {
  const u = (url.searchParams.get("u") || "").trim().toLowerCase();
  if (!USERNAME_RE.test(u)) return fail("Nume de utilizator invalid.", 400);
  const { data, error } = await client
    .from("citely_accounts")
    .select("salt")
    .eq("username", u)
    .maybeSingle();
  if (error) throw error;
  const salt =
    (data?.salt as string | undefined) ??
    crypto
      .createHash("sha256")
      .update("citely-salt:" + u)
      .digest()
      .subarray(0, 16)
      .toString("base64");
  return json({ salt });
}

async function register(client: SupabaseClient, request: Request) {
  const body = await readBody(request);
  const username = String(body?.["username"] ?? "")
    .trim()
    .toLowerCase();
  const salt = body?.["salt"];
  const verifier = String(body?.["verifier"] ?? "");
  if (!USERNAME_RE.test(username))
    return fail("Numele trebuie să aibă 3–32 caractere: litere, cifre, . _ -", 400);
  if (!isB64(salt, 64) || !VERIFIER_RE.test(verifier)) return fail("Cerere invalidă.", 400);

  const { error } = await client
    .from("citely_accounts")
    .insert({ username, salt, verifier_hash: sha256(verifier) });
  if (error) {
    if (error.code === "23505") return fail("Există deja un cont cu acest nume.", 409);
    throw error;
  }
  return json({ token: await createSession(client, username) }, 201);
}

async function login(client: SupabaseClient, request: Request) {
  const body = await readBody(request);
  const username = String(body?.["username"] ?? "")
    .trim()
    .toLowerCase();
  const verifier = String(body?.["verifier"] ?? "");
  const wrong = () => fail("Nume de utilizator sau parolă greșită.", 401);
  if (!USERNAME_RE.test(username) || !VERIFIER_RE.test(verifier)) return wrong();

  const { data: acc, error } = await client
    .from("citely_accounts")
    .select("verifier_hash, failed_attempts, locked_until")
    .eq("username", username)
    .maybeSingle();
  if (error) throw error;
  if (!acc) return wrong();
  if (acc.locked_until && new Date(acc.locked_until as string).getTime() > Date.now()) {
    return fail(`Prea multe încercări greșite. Încearcă din nou în ${LOCK_MINUTES} minute.`, 429);
  }
  if (!sameHash(sha256(verifier), acc.verifier_hash as string)) {
    const failed = (acc.failed_attempts as number) + 1;
    const locked = failed >= MAX_FAILED;
    await client
      .from("citely_accounts")
      .update({
        failed_attempts: locked ? 0 : failed,
        locked_until: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
      })
      .eq("username", username);
    return wrong();
  }
  if (acc.failed_attempts || acc.locked_until) {
    await client
      .from("citely_accounts")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("username", username);
  }
  return json({ token: await createSession(client, username) });
}

async function getVault(client: SupabaseClient, username: string) {
  const { data, error } = await client
    .from("citely_vaults")
    .select("iv, ct, updated_ms")
    .eq("username", username)
    .maybeSingle();
  if (error) throw error;
  return json({
    vault: data ? { iv: data.iv, ct: data.ct, updatedAt: Number(data.updated_ms) } : null,
  });
}

async function putVault(client: SupabaseClient, username: string, request: Request) {
  const body = await readBody(request);
  const updatedAt = Number(body?.["updatedAt"]);
  if (
    !isB64(body?.["iv"], 64) ||
    !isB64(body?.["ct"], MAX_CIPHERTEXT) ||
    !Number.isFinite(updatedAt)
  ) {
    return fail("Lista e prea mare sau invalidă.", 400);
  }
  const { error } = await client.from("citely_vaults").upsert({
    username,
    iv: body!["iv"],
    ct: body!["ct"],
    updated_ms: Math.round(updatedAt),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return json({ ok: true });
}

export async function handleCitelyApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // works for /citely/api/<route> (public URL) and /api/<route> (after the Vercel rewrite)
  const route = url.pathname.replace(/^.*?\/api\//, "").replace(/\/$/, "");
  const method = request.method.toUpperCase();
  try {
    const client = await db();
    if (route === "salt" && method === "GET") return await getSalt(client, url);
    if (route === "register" && method === "POST") return await register(client, request);
    if (route === "login" && method === "POST") return await login(client, request);

    if (route === "vault" || route === "logout") {
      const username = await sessionUser(client, request);
      if (!username) return fail("Sesiunea a expirat. Intră din nou în cont.", 401);
      if (route === "vault" && method === "GET") return await getVault(client, username);
      if (route === "vault" && method === "PUT") return await putVault(client, username, request);
      if (route === "logout" && method === "POST") {
        const token = (request.headers.get("authorization") || "").slice(7).trim();
        await client.from("citely_sessions").delete().eq("token_hash", sha256(token));
        return json({ ok: true });
      }
    }
    return fail("Not found", 404);
  } catch (err) {
    console.error("[citely]", err);
    return fail("Serverul nu a putut procesa cererea. Încearcă din nou.", 500);
  }
}
