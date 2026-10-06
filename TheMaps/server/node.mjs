import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { createApi } from "./api.mjs";
import { nodeAdapters } from "./adapters-node.mjs";
import { deviceSession } from "./device-session.mjs";

const adapters = await nodeAdapters();

const allowedOrigins = (
  process.env.APP_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173"
).split(",");

const app = new Hono();

app.route(
  "/",
  createApi({
    ...adapters,
    resolveUser: deviceSession,
    allowedOrigins,
  }),
);

app.all("/api/*", (c) => c.json({ error: "Không tìm thấy API." }, 404));

app.use("/*", serveStatic({ root: "./dist/local" }));

app.get("*", serveStatic({ path: "./dist/local/index.html" }));

const server = serve(
  {
    fetch: app.fetch,
    hostname: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 3001),
  },
  (info) => {
    console.log(`Atlas API: http://localhost:${info.port}`);
  },
);

async function stop() {
  server.close();
  await adapters.close();
  process.exit(0);
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
