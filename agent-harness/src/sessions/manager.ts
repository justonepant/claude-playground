import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { db, queries } from "../db/schema";
import { broadcast, broadcastToSession } from "../api/ws";

export type SessionStatus = "pending" | "running" | "paused" | "stopped" | "error" | "completed";

export interface SessionConfig {
  name: string;
  description?: string;
  workingDir: string;
  command: string;
  model?: string;
  maxTurns?: number;
  tokenBudget?: number;
  envVars?: Record<string, string>;
  prompt?: string;
}

export interface Session {
  id: string;
  name: string;
  description: string | null;
  status: SessionStatus;
  working_dir: string;
  command: string;
  model: string;
  max_turns: number | null;
  token_budget: number | null;
  env_vars: string;
  prompt: string | null;
  pid: number | null;
  exit_code: number | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

// Live process handles keyed by session id
const processes = new Map<string, ReturnType<typeof Bun.spawn>>();

export function createSession(config: SessionConfig): Session {
  const id = randomUUID();

  if (!existsSync(config.workingDir)) {
    throw new Error(`Working directory does not exist: ${config.workingDir}`);
  }

  queries.insertSession.run({
    $id: id,
    $name: config.name,
    $description: config.description ?? null,
    $working_dir: config.workingDir,
    $command: config.command,
    $model: config.model ?? "claude-sonnet-4-6",
    $max_turns: config.maxTurns ?? null,
    $token_budget: config.tokenBudget ?? null,
    $env_vars: JSON.stringify(config.envVars ?? {}),
    $prompt: config.prompt ?? null,
  });

  const session = queries.getSession.get(id) as Session;
  broadcast({ type: "session_created", session });
  return session;
}

export function startSession(id: string): void {
  const session = queries.getSession.get(id) as Session | null;
  if (!session) throw new Error(`Session ${id} not found`);
  if (session.status === "running") throw new Error("Session already running");

  const envVars = JSON.parse(session.env_vars) as Record<string, string>;

  // Build argv by splitting command string (simple shell-like split)
  const argv = splitCommand(session.command);

  const proc = Bun.spawn(argv, {
    cwd: session.working_dir,
    env: { ...process.env, ...envVars },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  processes.set(id, proc);
  queries.updatePid.run({ $pid: proc.pid, $id: id });
  broadcastStatus(id, "running");

  // Stream stdout
  streamOutput(id, proc.stdout, "stdout");
  // Stream stderr
  streamOutput(id, proc.stderr, "stderr");

  // Watch for exit
  proc.exited.then((code) => {
    processes.delete(id);
    const status: SessionStatus = code === 0 ? "completed" : "error";
    queries.updateFinished.run({ $status: status, $exit_code: code, $id: id });
    broadcastStatus(id, status);
    appendLog(id, "system", `--- Process exited with code ${code} ---`);
  });
}

async function streamOutput(
  sessionId: string,
  stream: ReadableStream<Uint8Array> | null,
  type: "stdout" | "stderr"
) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      appendLog(sessionId, type, line);
    }
  }
  if (buffer) appendLog(sessionId, type, buffer);
}

function appendLog(sessionId: string, stream: string, line: string) {
  queries.insertLog.run({ $session_id: sessionId, $stream: stream, $line: line });
  broadcastToSession(sessionId, { type: "log", sessionId, stream, line, ts: Date.now() });
}

function broadcastStatus(id: string, status: SessionStatus) {
  const session = queries.getSession.get(id) as Session;
  broadcast({ type: "session_updated", session });
}

export function pauseSession(id: string): void {
  const proc = processes.get(id);
  if (!proc) throw new Error("Session not running");
  try {
    process.kill(proc.pid, "SIGSTOP");
    queries.updateStatus.run({ $status: "paused", $id: id });
    broadcastStatus(id, "paused");
  } catch (e) {
    throw new Error(`Failed to pause: ${e}`);
  }
}

export function resumeSession(id: string): void {
  const proc = processes.get(id);
  if (!proc) throw new Error("Session not running");
  try {
    process.kill(proc.pid, "SIGCONT");
    queries.updateStatus.run({ $status: "running", $id: id });
    broadcastStatus(id, "running");
  } catch (e) {
    throw new Error(`Failed to resume: ${e}`);
  }
}

export function killSession(id: string): void {
  const proc = processes.get(id);
  if (proc) {
    try { proc.kill("SIGTERM"); } catch (_) {}
    processes.delete(id);
  }
  queries.updateStatus.run({ $status: "stopped", $id: id });
  broadcastStatus(id, "stopped");
}

export function sendInput(id: string, text: string): void {
  const proc = processes.get(id);
  if (!proc?.stdin) throw new Error("Session has no stdin");
  // Bun.spawn stdin with "pipe" is a FileSink
  const sink = proc.stdin as import("bun").FileSink;
  sink.write(text + "\n");
  sink.flush();
}

export function restartSession(id: string): void {
  const session = queries.getSession.get(id) as Session | null;
  if (!session) throw new Error(`Session ${id} not found`);
  if (processes.has(id)) killSession(id);
  queries.updateStatus.run({ $status: "pending", $id: id });
  startSession(id);
}

export function listSessions(): Session[] {
  return queries.listSessions.all() as Session[];
}

export function getSession(id: string): Session | null {
  return queries.getSession.get(id) as Session | null;
}

export function deleteSession(id: string): void {
  killSession(id);
  queries.deleteSession.run(id);
  broadcast({ type: "session_deleted", sessionId: id });
}

// Simple command splitter (handles quoted strings)
function splitCommand(cmd: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of cmd) {
    if (inQuote) {
      if (char === quoteChar) { inQuote = false; }
      else { current += char; }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === " " && current) {
      args.push(current);
      current = "";
    } else if (char !== " ") {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}
