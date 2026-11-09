// Local dev server: serves the page at /casinobyhacky and the API at /casinobyhacky/api/* on http://localhost:3000.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const out = path.join(root, ".dev", "api.mjs");
await build({
  entryPoints: [path.join(root, "src", "api.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: out,
});
const { handleCasinobyHackyApi } = await import(out);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/" ) {
      res.writeHead(302, { location: "/casinobyhacky" }).end();
      return;
    }
    if (/^\/casinobyhacky\/?$/i.test(url.pathname)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(fs.readFileSync(path.join(root, "casinobyhacky", "index.html")));
      return;
    }
    if (url.pathname.startsWith("/casinobyhacky/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await handleCasinobyHackyApi(
        new Request("http://localhost" + req.url, {
          method: req.method,
          headers: req.headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
        }),
      );
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    res.writeHead(404).end("Not found");
  })
  .listen(3000, () => console.log("CasinobyHacky on http://localhost:3000/casinobyhacky"));
