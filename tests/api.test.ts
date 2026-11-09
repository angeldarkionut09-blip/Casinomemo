import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Minimal in-memory stand-in for the Supabase query builder calls the Citely API uses. */
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const KEYS: Record<string, string> = {
  citely_accounts: "username",
  citely_sessions: "token_hash",
  citely_vaults: "username",
};

function query(table: string) {
  const rows = () => (tables[table] ||= []);
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" | "delete" = "select";
  let patch: Row = {};
  const api = {
    select() {
      op = "select";
      return api;
    },
    update(p: Row) {
      op = "update";
      patch = p;
      return api;
    },
    delete() {
      op = "delete";
      return api;
    },
    eq(k: string, v: unknown) {
      filters.push((r) => r[k] === v);
      return api;
    },
    lt(k: string, v: string) {
      filters.push((r) => String(r[k]) < v);
      return api;
    },
    insert(row: Row) {
      const key = KEYS[table]!;
      if (rows().some((r) => r[key] === row[key]))
        return Promise.resolve({ error: { code: "23505" } });
      rows().push({ failed_attempts: 0, locked_until: null, ...row });
      return Promise.resolve({ error: null });
    },
    upsert(row: Row) {
      const key = KEYS[table]!;
      const i = rows().findIndex((r) => r[key] === row[key]);
      if (i >= 0) rows()[i] = { ...rows()[i], ...row };
      else rows().push(row);
      return Promise.resolve({ error: null });
    },
    maybeSingle() {
      const r = rows().find((x) => filters.every((f) => f(x)));
      return Promise.resolve({ data: r ? { ...r } : null, error: null });
    },
    then(res: (v: { error: null }) => void) {
      const hit = (r: Row) => filters.every((f) => f(r));
      if (op === "update") rows().forEach((r) => hit(r) && Object.assign(r, patch));
      if (op === "delete") tables[table] = rows().filter((r) => !hit(r));
      res({ error: null });
    },
  };
  return api;
}
vi.mock("../src/db.js", () => ({
  getDb: () => ({ from: (t: string) => query(t) }),
}));

const { handleCitelyApi } = await import("../src/api.js");
const call = (path: string, init: RequestInit = {}) =>
  handleCitelyApi(new Request("https://auto-core.ro/citely/api/" + path, init));
const post = (path: string, body: unknown, token?: string) =>
  call(path, {
    method: path === "vault" ? "PUT" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });
const verifier = (p: string) => crypto.createHash("sha256").update(p).digest("hex");
const salt = crypto.randomBytes(16).toString("base64");

describe("Citely API", () => {
  beforeEach(() => {
    for (const k of Object.keys(tables)) delete tables[k];
  });

  it("registers, logs in and keeps each user's list separate", async () => {
    const r1 = await post("register", { username: "ana", salt, verifier: verifier("a") });
    expect(r1.status).toBe(201);
    const { token: ta } = await r1.json();
    expect(
      await (
        await post("register", { username: "ana", salt, verifier: verifier("x") })
      ).status,
    ).toBe(409);

    expect((await post("vault", { iv: "aXY=", ct: "Y3Q=", updatedAt: 5 }, ta)).status).toBe(200);
    const tb = (
      await (await post("register", { username: "bogdan", salt, verifier: verifier("b") })).json()
    ).token;

    const va = await (await call("vault", { headers: { authorization: "Bearer " + ta } })).json();
    const vb = await (await call("vault", { headers: { authorization: "Bearer " + tb } })).json();
    expect(va.vault).toEqual({ iv: "aXY=", ct: "Y3Q=", updatedAt: 5 });
    expect(vb.vault).toBeNull();

    const s = await (await call("salt?u=ana")).json();
    expect(s.salt).toBe(salt);
    expect((await post("login", { username: "ana", verifier: verifier("a") })).status).toBe(200);
    expect((await post("login", { username: "ana", verifier: verifier("wrong") })).status).toBe(
      401,
    );
  });

  it("never stores the verifier itself and hides unknown accounts", async () => {
    await post("register", { username: "ana", salt, verifier: verifier("a") });
    expect(tables["citely_accounts"]![0]!["verifier_hash"]).not.toBe(verifier("a"));
    const fake = await (await call("salt?u=nimeni")).json();
    expect(fake.salt).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect((await post("login", { username: "nimeni", verifier: verifier("a") })).status).toBe(401);
  });

  it("rejects requests without a valid session and locks after repeated failures", async () => {
    expect((await call("vault")).status).toBe(401);
    expect((await call("vault", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    await post("register", { username: "ana", salt, verifier: verifier("a") });
    for (let i = 0; i < 10; i++)
      await post("login", { username: "ana", verifier: verifier("bad" + i) });
    expect((await post("login", { username: "ana", verifier: verifier("a") })).status).toBe(429);
  });

  it("logout ends the session", async () => {
    const { token } = await (
      await post("register", { username: "ana", salt, verifier: verifier("a") })
    ).json();
    expect((await post("logout", {}, token)).status).toBe(200);
    expect((await call("vault", { headers: { authorization: "Bearer " + token } })).status).toBe(
      401,
    );
  });
});
