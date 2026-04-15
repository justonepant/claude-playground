import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = process.env.DB_PATH ?? join(import.meta.dir, "../../../data/harness.db");

// Ensure data directory exists
import { mkdirSync } from "fs";
mkdirSync(join(DB_PATH, ".."), { recursive: true });

export const db = new Database(DB_PATH, { create: true });

db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA foreign_keys = ON;");

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    working_dir TEXT NOT NULL,
    command     TEXT NOT NULL,
    model       TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    max_turns   INTEGER,
    token_budget INTEGER,
    env_vars    TEXT NOT NULL DEFAULT '{}',
    prompt      TEXT,
    pid         INTEGER,
    exit_code   INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    started_at  TEXT,
    finished_at TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    stream     TEXT NOT NULL DEFAULT 'stdout',
    line       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_logs_session ON logs(session_id, id)`);

db.run(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    label       TEXT,
    patch       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS usage (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd     REAL NOT NULL DEFAULT 0,
    recorded_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

export const queries = {
  insertSession: db.prepare(`
    INSERT INTO sessions (id, name, description, working_dir, command, model, max_turns, token_budget, env_vars, prompt)
    VALUES ($id, $name, $description, $working_dir, $command, $model, $max_turns, $token_budget, $env_vars, $prompt)
  `),
  updateStatus: db.prepare(`
    UPDATE sessions SET status = $status, updated_at = datetime('now')
    WHERE id = $id
  `),
  updatePid: db.prepare(`
    UPDATE sessions SET pid = $pid, started_at = datetime('now'), status = 'running', updated_at = datetime('now')
    WHERE id = $id
  `),
  updateFinished: db.prepare(`
    UPDATE sessions SET status = $status, exit_code = $exit_code, finished_at = datetime('now'), updated_at = datetime('now')
    WHERE id = $id
  `),
  getSession: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
  listSessions: db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),
  insertLog: db.prepare(`INSERT INTO logs (session_id, stream, line) VALUES ($session_id, $stream, $line)`),
  getLogs: db.prepare(`SELECT * FROM logs WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?`),
  getLogsAfter: db.prepare(`SELECT * FROM logs WHERE session_id = ? AND id > ? ORDER BY id ASC`),
  countLogs: db.prepare(`SELECT COUNT(*) as count FROM logs WHERE session_id = ?`),
  insertUsage: db.prepare(`INSERT INTO usage (session_id, input_tokens, output_tokens, cost_usd) VALUES ($session_id, $input_tokens, $output_tokens, $cost_usd)`),
  getUsage: db.prepare(`SELECT SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(cost_usd) as cost FROM usage WHERE session_id = ?`),
  getTotalUsage: db.prepare(`SELECT SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(cost_usd) as cost FROM usage`),
  getDailyUsage: db.prepare(`SELECT date(recorded_at) as day, SUM(cost_usd) as cost FROM usage GROUP BY day ORDER BY day DESC LIMIT 30`),
};
