import {
  createSession,
  startSession,
  pauseSession,
  resumeSession,
  killSession,
  restartSession,
  deleteSession,
  listSessions,
  getSession,
  sendInput,
  type SessionConfig,
} from "../sessions/manager";
import { queries } from "../db/schema";
import { execSync } from "child_process";

export type RouteHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const val = await req.json();
    if (val && typeof val === "object" && !Array.isArray(val)) return val as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : (typeof v === "string" && v !== "" ? Number(v) : undefined);
}

// ── Sessions ──────────────────────────────────────────────

export const listSessionsHandler: RouteHandler = () => json(listSessions());

export const createSessionHandler: RouteHandler = async (req) => {
  const body = await parseBody(req);
  const name = str(body.name);
  const workingDir = str(body.workingDir);
  const command = str(body.command);
  if (!name || !workingDir || !command) {
    return json({ error: "name, workingDir, and command are required" }, 400);
  }
  try {
    const config: SessionConfig = {
      name,
      workingDir,
      command,
      description: str(body.description),
      model: str(body.model),
      maxTurns: num(body.maxTurns),
      tokenBudget: num(body.tokenBudget),
      envVars: (body.envVars && typeof body.envVars === "object" && !Array.isArray(body.envVars))
        ? body.envVars as Record<string, string>
        : undefined,
      prompt: str(body.prompt),
    };
    const session = createSession(config);
    if (body.autoStart) startSession(session.id);
    return json(session, 201);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }
};

export const getSessionHandler: RouteHandler = (_req, params) => {
  const session = getSession(params.id!);
  if (!session) return json({ error: "Not found" }, 404);
  return json(session);
};

export const deleteSessionHandler: RouteHandler = (_req, params) => {
  if (!getSession(params.id!)) return json({ error: "Not found" }, 404);
  deleteSession(params.id!);
  return json({ ok: true });
};

export const startHandler: RouteHandler = (_req, params) => {
  try { startSession(params.id!); return json({ ok: true }); }
  catch (e: unknown) { return json({ error: (e as Error).message }, 400); }
};

export const pauseHandler: RouteHandler = (_req, params) => {
  try { pauseSession(params.id!); return json({ ok: true }); }
  catch (e: unknown) { return json({ error: (e as Error).message }, 400); }
};

export const resumeHandler: RouteHandler = (_req, params) => {
  try { resumeSession(params.id!); return json({ ok: true }); }
  catch (e: unknown) { return json({ error: (e as Error).message }, 400); }
};

export const killHandler: RouteHandler = (_req, params) => {
  killSession(params.id!);
  return json({ ok: true });
};

export const restartHandler: RouteHandler = (_req, params) => {
  try { restartSession(params.id!); return json({ ok: true }); }
  catch (e: unknown) { return json({ error: (e as Error).message }, 400); }
};

export const inputHandler: RouteHandler = async (req, params) => {
  const body = await parseBody(req);
  const text = str(body.text);
  if (!text) return json({ error: "text required" }, 400);
  try { sendInput(params.id!, text); return json({ ok: true }); }
  catch (e: unknown) { return json({ error: (e as Error).message }, 400); }
};

// ── Logs ──────────────────────────────────────────────────

export const logsHandler: RouteHandler = (req, params) => {
  if (!getSession(params.id!)) return json({ error: "Not found" }, 404);
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 500);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const after = Number(url.searchParams.get("after") ?? 0);
  const logs = after > 0
    ? queries.getLogsAfter.all(params.id!, after)
    : queries.getLogs.all(params.id!, limit, offset);
  const row = queries.countLogs.get(params.id!) as { count: number };
  return json({ logs, total: row.count });
};

// ── Git ───────────────────────────────────────────────────

export const diffHandler: RouteHandler = (_req, params) => {
  const session = getSession(params.id!);
  if (!session) return json({ error: "Not found" }, 404);
  try {
    const diff = execSync("git diff", { cwd: session.working_dir, encoding: "utf8" });
    const status = execSync("git status --short", { cwd: session.working_dir, encoding: "utf8" });
    return json({ diff, status });
  } catch (e: unknown) {
    return json({ diff: "", status: "", error: (e as Error).message });
  }
};

export const filesHandler: RouteHandler = (req, params) => {
  const session = getSession(params.id!);
  if (!session) return json({ error: "Not found" }, 404);
  const url = new URL(req.url);
  const rel = url.searchParams.get("path") ?? ".";
  try {
    const out = execSync(`find ${JSON.stringify(rel)} -maxdepth 1 -printf '%y %P\n'`, {
      cwd: session.working_dir,
      encoding: "utf8",
    });
    const entries = out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const spaceIdx = line.indexOf(" ");
        const type = line.slice(0, spaceIdx);
        const name = line.slice(spaceIdx + 1);
        return { type: type === "d" ? "dir" : "file", name };
      })
      .filter((e) => e.name && e.name !== ".");
    return json({ path: rel, entries });
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }
};

// ── Usage ─────────────────────────────────────────────────

export const sessionUsageHandler: RouteHandler = (_req, params) => {
  if (!getSession(params.id!)) return json({ error: "Not found" }, 404);
  return json(queries.getUsage.get(params.id!));
};

export const recordUsageHandler: RouteHandler = async (req, params) => {
  const body = await parseBody(req);
  queries.insertUsage.run({
    $session_id: params.id!,
    $input_tokens: num(body.inputTokens) ?? 0,
    $output_tokens: num(body.outputTokens) ?? 0,
    $cost_usd: num(body.costUsd) ?? 0,
  });
  return json({ ok: true });
};

export const statsHandler: RouteHandler = () => {
  return json({
    total: queries.getTotalUsage.get(),
    daily: queries.getDailyUsage.all(),
  });
};
