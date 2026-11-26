import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Serves the Vercel function api/join.ts during local development.
function localApi(): Plugin {
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use("/api/join", async (req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          const mod = await server.ssrLoadModule("/api/join.js");
          const out = { code: 200, json: (b: unknown) => { res.statusCode = out.code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(b)); } };
          await mod.default({ method: req.method, body, headers: req.headers }, { status: (n: number) => { out.code = n; return out; } });
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [react(), localApi()], define: { "process.env.NODE_DEBUG": "false" } };
});
