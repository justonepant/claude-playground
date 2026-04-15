import type { ServerWebSocket } from "bun";
import { registerClient, unregisterClient } from "./src/api/ws";
import {
  listSessionsHandler, createSessionHandler, getSessionHandler, deleteSessionHandler,
  startHandler, pauseHandler, resumeHandler, killHandler, restartHandler, inputHandler,
  logsHandler, diffHandler, filesHandler, sessionUsageHandler, recordUsageHandler, statsHandler,
  type RouteHandler,
} from "./src/api/handlers";
import index from "./frontend/index.html";

type WSData = { sessionId?: string };

const PORT = Number(process.env.PORT ?? 3700);

type Method = "GET" | "POST" | "DELETE" | "PUT" | "PATCH";

interface Route {
  method: Method;
  pattern: string;
  handler: RouteHandler;
}

function matchRoute(pathname: string, pattern: string): Record<string, string> | null {
  const pParts = pattern.split("/");
  const uParts = pathname.split("/");
  if (pParts.length !== uParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pParts.length; i++) {
    const p = pParts[i]!;
    const u = uParts[i]!;
    if (p.startsWith(":")) {
      params[p.slice(1)] = u;
    } else if (p !== u) {
      return null;
    }
  }
  return params;
}

const routes: Route[] = [
  { method: "GET",    pattern: "/api/sessions",             handler: listSessionsHandler },
  { method: "POST",   pattern: "/api/sessions",             handler: createSessionHandler },
  { method: "GET",    pattern: "/api/sessions/:id",         handler: getSessionHandler },
  { method: "DELETE", pattern: "/api/sessions/:id",         handler: deleteSessionHandler },
  { method: "POST",   pattern: "/api/sessions/:id/start",   handler: startHandler },
  { method: "POST",   pattern: "/api/sessions/:id/pause",   handler: pauseHandler },
  { method: "POST",   pattern: "/api/sessions/:id/resume",  handler: resumeHandler },
  { method: "POST",   pattern: "/api/sessions/:id/kill",    handler: killHandler },
  { method: "POST",   pattern: "/api/sessions/:id/restart", handler: restartHandler },
  { method: "POST",   pattern: "/api/sessions/:id/input",   handler: inputHandler },
  { method: "GET",    pattern: "/api/sessions/:id/logs",    handler: logsHandler },
  { method: "GET",    pattern: "/api/sessions/:id/diff",    handler: diffHandler },
  { method: "GET",    pattern: "/api/sessions/:id/files",   handler: filesHandler },
  { method: "GET",    pattern: "/api/sessions/:id/usage",   handler: sessionUsageHandler },
  { method: "POST",   pattern: "/api/sessions/:id/usage",   handler: recordUsageHandler },
  { method: "GET",    pattern: "/api/stats",                handler: statsHandler },
];

Bun.serve<WSData>({
  port: PORT,
  routes: {
    "/": index,
  },
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      const sessionId = url.searchParams.get("session") ?? undefined;
      server.upgrade(req, { data: { sessionId } });
      return;
    }

    // API routing
    const method = req.method as Method;
    for (const route of routes) {
      if (route.method !== method) continue;
      const params = matchRoute(url.pathname, route.pattern);
      if (params !== null) return route.handler(req, params);
    }

    // SPA fallback
    if (!url.pathname.startsWith("/api/")) {
      return new Response(Bun.file("./frontend/index.html"));
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws: ServerWebSocket<WSData>) {
      registerClient(ws);
    },
    message(ws: ServerWebSocket<WSData>, msg: string | Buffer) {
      try {
        const data = JSON.parse(msg as string) as { type: string };
        if (data.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      } catch (_) {}
    },
    close(ws: ServerWebSocket<WSData>) {
      unregisterClient(ws);
    },
  },
});

console.log(`
╔══════════════════════════════════════╗
║      Agent Harness  ·  ready         ║
║  http://localhost:${PORT}              ║
║  ws://localhost:${PORT}               ║
╚══════════════════════════════════════╝
`);
