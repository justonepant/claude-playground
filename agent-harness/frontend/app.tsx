import React, {
  useState, useEffect, useRef, useCallback, createContext, useContext,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// ── Types ──────────────────────────────────────────────────

type Status = "pending" | "running" | "paused" | "stopped" | "error" | "completed";

interface Session {
  id: string;
  name: string;
  description: string | null;
  status: Status;
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

interface LogEntry {
  id: number;
  session_id: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
  created_at: string;
}

interface Stats {
  total: { input: number; output: number; cost: number } | null;
  daily: Array<{ day: string; cost: number }>;
}

// ── API ────────────────────────────────────────────────────

const api = {
  async get<T>(path: string): Promise<T> {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del<T>(path: string): Promise<T> {
    const r = await fetch(path, { method: "DELETE" });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

// ── Toast context ──────────────────────────────────────────

const ToastCtx = createContext<(msg: string, type?: "info" | "error") => void>(() => {});

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; type: string }>>([]);
  const add = useCallback((msg: string, type = "info") => {
    const id = Date.now();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── WebSocket hook ─────────────────────────────────────────

function useWS(onMessage: (msg: unknown) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(`ws://${window.location.host}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        // heartbeat
        const hb = setInterval(() => ws.send(JSON.stringify({ type: "ping" })), 25000);
        ws.addEventListener("close", () => clearInterval(hb));
      };
      ws.onmessage = (e) => {
        try { cbRef.current(JSON.parse(e.data)); } catch (_) {}
      };
      ws.onclose = () => {
        setConnected(false);
        retryTimer = setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, []);

  return connected;
}

// ── ANSI color renderer (subset) ──────────────────────────

const ANSI_RE = /\x1b\[([0-9;]*)m/g;

function renderAnsi(line: string): React.ReactNode {
  // Strip all ANSI codes for simplicity; a full renderer would be large
  return line.replace(ANSI_RE, "");
}

// ── Status badge ───────────────────────────────────────────

function Badge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

// ── Icons ──────────────────────────────────────────────────

const Icons = {
  sessions: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/>
    </svg>
  ),
  stats: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 20V10M12 20V4M6 20v-6"/>
    </svg>
  ),
  back: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="22" height="22">
      <path d="M15 18l-6-6 6-6"/>
    </svg>
  ),
  play: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  ),
  pause: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
    </svg>
  ),
  stop: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
    </svg>
  ),
  restart: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-4.02"/>
    </svg>
  ),
  trash: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6m5 0V4h4v2"/>
    </svg>
  ),
  terminal: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  ),
  file: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  folder: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ),
};

// ── New Session Modal ──────────────────────────────────────

interface NewSessionModalProps {
  onClose: () => void;
  onCreated: (s: Session) => void;
}

function NewSessionModal({ onClose, onCreated }: NewSessionModalProps) {
  const toast = useContext(ToastCtx);
  const [form, setForm] = useState({
    name: "",
    description: "",
    workingDir: "",
    command: "claude --model claude-sonnet-4-6",
    model: "claude-sonnet-4-6",
    maxTurns: "",
    tokenBudget: "",
    prompt: "",
    envVars: "",
    autoStart: true,
  });
  type FormKey = keyof typeof form;
  const [loading, setLoading] = useState(false);

  function set(k: FormKey, v: string | boolean) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      let envVars: Record<string, string> = {};
      if (form.envVars.trim()) {
        for (const line of form.envVars.split("\n")) {
          const eq = line.indexOf("=");
          if (eq > 0) envVars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }
      const session = await api.post<Session>("/api/sessions", {
        name: form.name,
        description: form.description || undefined,
        workingDir: form.workingDir,
        command: form.command,
        model: form.model,
        maxTurns: form.maxTurns ? Number(form.maxTurns) : undefined,
        tokenBudget: form.tokenBudget ? Number(form.tokenBudget) : undefined,
        prompt: form.prompt || undefined,
        envVars,
        autoStart: form.autoStart,
      });
      onCreated(session);
      onClose();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-handle" />
        <h3>New Session</h3>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Name *</label>
            <input className="form-control" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("name", e.target.value)} placeholder="My coding session" required />
          </div>
          <div className="form-group">
            <label>Description</label>
            <input className="form-control" value={form.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("description", e.target.value)} placeholder="Optional" />
          </div>
          <div className="form-group">
            <label>Working Directory *</label>
            <input className="form-control mono" value={form.workingDir} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("workingDir", e.target.value)} placeholder="/home/user/my-project" required />
          </div>
          <div className="form-group">
            <label>Command *</label>
            <input className="form-control mono" value={form.command} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("command", e.target.value)} required />
          </div>
          <div className="form-group">
            <label>System Prompt</label>
            <textarea className="form-control" value={form.prompt} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set("prompt", e.target.value)} placeholder="You are a helpful coding assistant..." rows={3} />
          </div>
          <div className="form-group">
            <label>Max Turns</label>
            <input className="form-control" type="number" value={form.maxTurns} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("maxTurns", e.target.value)} placeholder="Unlimited" min="1" />
          </div>
          <div className="form-group">
            <label>Token Budget</label>
            <input className="form-control" type="number" value={form.tokenBudget} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("tokenBudget", e.target.value)} placeholder="Unlimited" min="1000" />
          </div>
          <div className="form-group">
            <label>Environment Variables</label>
            <textarea className="form-control mono" value={form.envVars} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set("envVars", e.target.value)} placeholder={"API_KEY=abc123\nDEBUG=true"} rows={3} />
          </div>
          <div className="form-group" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="checkbox" id="autoStart" checked={form.autoStart} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("autoStart", e.target.checked)} style={{ width: 16, height: 16 }} />
            <label htmlFor="autoStart" style={{ marginBottom: 0, cursor: "pointer" }}>Start immediately</label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Creating…" : "Create Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Log view ───────────────────────────────────────────────

function LogView({ sessionId, status }: { sessionId: string; status: Status }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);
  const toast = useContext(ToastCtx);

  // Load initial logs
  useEffect(() => {
    api.get<{ logs: LogEntry[] }>(`/api/sessions/${sessionId}/logs?limit=500`)
      .then(({ logs }) => {
        setLogs(logs);
        const last = logs[logs.length - 1];
        if (last) lastIdRef.current = last.id;
      });
  }, [sessionId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Listen for WS events
  const handleMsg = useCallback((msg: any) => {
    if (msg.type === "log" && msg.sessionId === sessionId) {
      const entry: LogEntry = {
        id: Date.now() + Math.random(),
        session_id: sessionId,
        stream: msg.stream,
        line: msg.line,
        created_at: new Date().toISOString(),
      };
      setLogs((l) => [...l, entry]);
    }
  }, [sessionId]);

  // Subscribe via WS — parent App passes events down via context instead
  // We'll use a local WS connection scoped to this session
  useEffect(() => {
    const ws = new WebSocket(`ws://${location.host}?session=${sessionId}`);
    ws.onmessage = (e) => {
      try { handleMsg(JSON.parse(e.data)); } catch (_) {}
    };
    return () => ws.close();
  }, [sessionId, handleMsg]);

  async function sendInput() {
    if (!input.trim()) return;
    try {
      await api.post(`/api/sessions/${sessionId}/input`, { text: input });
      setInput("");
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="log-view" style={{ flex: 1 }}>
        {logs.length === 0 && (
          <div style={{ color: "var(--text2)", fontStyle: "italic" }}>No output yet…</div>
        )}
        {logs.map((l, i) => (
          <div key={l.id ?? i} className={`log-line ${l.stream}`}>
            {renderAnsi(l.line)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {status === "running" && (
        <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderTop: "1px solid var(--border)", background: "var(--bg1)" }}>
          <input
            className="form-control"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send input to process…"
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && sendInput()}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary btn-sm" onClick={sendInput}>Send</button>
        </div>
      )}
    </div>
  );
}

// ── Diff view ──────────────────────────────────────────────

function DiffView({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<{ diff: string; status: string } | null>(null);

  useEffect(() => {
    api.get<{ diff: string; status: string }>(`/api/sessions/${sessionId}/diff`)
      .then(setData);
  }, [sessionId]);

  function renderDiff(diff: string) {
    return diff.split("\n").map((line, i) => {
      let cls = "";
      if (line.startsWith("+") && !line.startsWith("+++")) cls = "diff-added";
      else if (line.startsWith("-") && !line.startsWith("---")) cls = "diff-removed";
      else if (line.startsWith("@@")) cls = "diff-hunk";
      else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) cls = "diff-header";
      return <span key={i} className={cls}>{line}{"\n"}</span>;
    });
  }

  if (!data) return <div className="empty"><p>Loading…</p></div>;

  return (
    <div className="diff-view" style={{ overflow: "auto", height: "100%" }}>
      {data.status && <div className="git-status">{data.status || "(no changes)"}</div>}
      {data.diff ? <pre>{renderDiff(data.diff)}</pre> : <div style={{ color: "var(--text2)" }}>No unstaged changes.</div>}
    </div>
  );
}

// ── File browser ───────────────────────────────────────────

function FileBrowser({ sessionId }: { sessionId: string }) {
  const [path, setPath] = useState(".");
  const [entries, setEntries] = useState<Array<{ type: string; name: string }>>([]);

  useEffect(() => {
    api.get<{ entries: Array<{ type: string; name: string }> }>(`/api/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`)
      .then((d) => setEntries(d.entries));
  }, [sessionId, path]);

  function nav(entry: { type: string; name: string }) {
    if (entry.type === "dir") {
      setPath(path === "." ? entry.name : `${path}/${entry.name}`);
    }
  }

  function goUp() {
    const idx = path.lastIndexOf("/");
    setPath(idx > 0 ? path.substring(0, idx) : ".");
  }

  return (
    <div className="file-list" style={{ overflow: "auto", height: "100%" }}>
      {path !== "." && (
        <div className="file-entry" onClick={goUp}>
          <span style={{ color: "var(--accent)" }}>←</span> ..
        </div>
      )}
      {entries.map((e, i) => (
        <div key={i} className={`file-entry ${e.type}`} onClick={() => nav(e)}>
          {e.type === "dir" ? <Icons.folder /> : <Icons.file />}
          {e.name}
        </div>
      ))}
      {entries.length === 0 && <div style={{ color: "var(--text2)", fontSize: 13 }}>Empty directory</div>}
    </div>
  );
}

// ── Session detail view ────────────────────────────────────

function SessionDetail({
  session: initial,
  onBack,
  onUpdate,
}: {
  session: Session;
  onBack: () => void;
  onUpdate: (s: Session) => void;
}) {
  const [session, setSession] = useState(initial);
  const [tab, setTab] = useState<"logs" | "diff" | "files" | "info">("logs");
  const toast = useContext(ToastCtx);

  // Keep session in sync with WS updates
  useEffect(() => setSession(initial), [initial]);

  async function action(endpoint: string, label: string) {
    try {
      await api.post(`/api/sessions/${session.id}/${endpoint}`);
      toast(`${label} sent`);
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  const isRunning = session.status === "running";
  const isPaused = session.status === "paused";
  const isAlive = isRunning || isPaused;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="session-header">
        <button className="back-btn" onClick={onBack}><Icons.back /></button>
        <h2>{session.name}</h2>
        <Badge status={session.status} />
      </div>

      <div className="controls">
        {!isAlive && (
          <button className="btn btn-primary btn-sm" onClick={() => action("start", "Start")}>
            <Icons.play /> Start
          </button>
        )}
        {isRunning && (
          <button className="btn btn-secondary btn-sm" onClick={() => action("pause", "Pause")}>
            <Icons.pause /> Pause
          </button>
        )}
        {isPaused && (
          <button className="btn btn-secondary btn-sm" onClick={() => action("resume", "Resume")}>
            <Icons.play /> Resume
          </button>
        )}
        {isAlive && (
          <button className="btn btn-danger btn-sm" onClick={() => action("kill", "Kill")}>
            <Icons.stop /> Kill
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => action("restart", "Restart")}>
          <Icons.restart /> Restart
        </button>
      </div>

      <div className="tabs">
        {(["logs", "diff", "files", "info"] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "logs" && <LogView sessionId={session.id} status={session.status} />}
        {tab === "diff" && <DiffView sessionId={session.id} />}
        {tab === "files" && <FileBrowser sessionId={session.id} />}
        {tab === "info" && <SessionInfo session={session} />}
      </div>
    </div>
  );
}

// ── Session info tab ───────────────────────────────────────

function SessionInfo({ session }: { session: Session }) {
  const [usage, setUsage] = useState<{ input: number; output: number; cost: number } | null>(null);

  useEffect(() => {
    api.get<any>(`/api/sessions/${session.id}/usage`).then(setUsage);
  }, [session.id]);

  const rows: Array<[string, string]> = [
    ["Command", session.command],
    ["Directory", session.working_dir],
    ["Model", session.model],
    ["PID", session.pid?.toString() ?? "—"],
    ["Exit code", session.exit_code?.toString() ?? "—"],
    ["Max turns", session.max_turns?.toString() ?? "Unlimited"],
    ["Token budget", session.token_budget?.toString() ?? "Unlimited"],
    ["Created", new Date(session.created_at).toLocaleString()],
    ["Started", session.started_at ? new Date(session.started_at).toLocaleString() : "—"],
    ["Finished", session.finished_at ? new Date(session.finished_at).toLocaleString() : "—"],
  ];

  return (
    <div style={{ overflow: "auto", flex: 1, padding: 16 }}>
      {usage && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div className="stat-card" style={{ flex: 1 }}>
            <div className="stat-label">Tokens in</div>
            <div className="stat-value" style={{ fontSize: 16 }}>{(usage.input ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card" style={{ flex: 1 }}>
            <div className="stat-label">Tokens out</div>
            <div className="stat-value" style={{ fontSize: 16 }}>{(usage.output ?? 0).toLocaleString()}</div>
          </div>
          <div className="stat-card" style={{ flex: 1 }}>
            <div className="stat-label">Cost</div>
            <div className="stat-value" style={{ fontSize: 16 }}>${(usage.cost ?? 0).toFixed(4)}</div>
          </div>
        </div>
      )}
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
          <span style={{ color: "var(--text2)", width: 100, flexShrink: 0 }}>{label}</span>
          <span className="mono" style={{ color: "var(--text0)", wordBreak: "break-all" }}>{value}</span>
        </div>
      ))}
      {session.prompt && (
        <>
          <div className="section-title" style={{ paddingLeft: 0 }}>System Prompt</div>
          <pre style={{ fontSize: 12, color: "var(--text1)", whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{session.prompt}</pre>
        </>
      )}
    </div>
  );
}

// ── Sessions list view ─────────────────────────────────────

function SessionsList({
  sessions,
  onSelect,
  onNew,
}: {
  sessions: Session[];
  onSelect: (s: Session) => void;
  onNew: () => void;
}) {
  const toast = useContext(ToastCtx);

  async function del(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm("Delete this session?")) return;
    try {
      await api.del(`/api/sessions/${id}`);
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  const active = sessions.filter((s) => s.status === "running" || s.status === "paused");
  const rest = sessions.filter((s) => s.status !== "running" && s.status !== "paused");

  function SessionCard({ s }: { s: Session }) {
    return (
      <div className="card" onClick={() => onSelect(s)}>
        <div className="card-row">
          <div className="card-title">{s.name}</div>
          <Badge status={s.status} />
          <button className="btn btn-ghost btn-sm btn-icon" onClick={(e) => del(e, s.id)} style={{ marginLeft: 4 }}>
            <Icons.trash />
          </button>
        </div>
        {s.description && <div className="card-desc">{s.description}</div>}
        <div className="card-meta">
          <span><Icons.terminal />{s.command.split(" ")[0]}</span>
          <span style={{ color: "var(--text2)" }}>{s.working_dir.split("/").pop()}</span>
          <span style={{ marginLeft: "auto" }}>{new Date(s.updated_at).toLocaleTimeString()}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {sessions.length === 0 ? (
        <div className="empty">
          <Icons.sessions />
          <p>No sessions yet.<br />Tap + to create one.</p>
        </div>
      ) : (
        <div className="card-list">
          {active.length > 0 && (
            <>
              <div className="section-title">Active</div>
              {active.map((s) => <SessionCard key={s.id} s={s} />)}
            </>
          )}
          {rest.length > 0 && (
            <>
              {active.length > 0 && <div className="section-title">History</div>}
              {rest.map((s) => <SessionCard key={s.id} s={s} />)}
            </>
          )}
        </div>
      )}
      <button className="fab" onClick={onNew}>+</button>
    </div>
  );
}

// ── Stats view ─────────────────────────────────────────────

function StatsView() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get<Stats>("/api/stats").then(setStats);
    const t = setInterval(() => api.get<Stats>("/api/stats").then(setStats), 10000);
    return () => clearInterval(t);
  }, []);

  if (!stats) return <div className="empty"><p>Loading…</p></div>;

  const total = stats.total;
  const maxCost = Math.max(...stats.daily.map((d) => d.cost), 0.001);

  return (
    <div style={{ overflow: "auto", flex: 1 }}>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Input Tokens</div>
          <div className="stat-value">{((total?.input ?? 0) / 1000).toFixed(1)}<span className="stat-unit">k</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Output Tokens</div>
          <div className="stat-value">{((total?.output ?? 0) / 1000).toFixed(1)}<span className="stat-unit">k</span></div>
        </div>
        <div className="stat-card" style={{ gridColumn: "1/-1" }}>
          <div className="stat-label">Total Cost</div>
          <div className="stat-value">${(total?.cost ?? 0).toFixed(4)}<span className="stat-unit"> USD</span></div>
        </div>
      </div>

      {stats.daily.length > 0 && (
        <>
          <div className="section-title">Daily Cost (last 30 days)</div>
          <div className="daily-chart">
            {stats.daily.map((d) => (
              <div key={d.day} className="daily-row">
                <div className="daily-day">{d.day}</div>
                <div className="daily-bar-wrap">
                  <div className="daily-bar" style={{ width: `${(d.cost / maxCost) * 100}%` }} />
                </div>
                <div className="daily-cost">${d.cost.toFixed(4)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── App root ───────────────────────────────────────────────

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [tab, setTab] = useState<"sessions" | "stats">("sessions");
  const [showNew, setShowNew] = useState(false);
  const toast = useContext(ToastCtx);

  // Load sessions
  useEffect(() => {
    api.get<Session[]>("/api/sessions").then(setSessions).catch(() => {});
  }, []);

  // WS live updates
  const connected = useWS(useCallback((msg: any) => {
    switch (msg.type) {
      case "session_created":
        setSessions((s) => [msg.session, ...s]);
        break;
      case "session_updated":
        setSessions((s) => s.map((x) => x.id === msg.session.id ? msg.session : x));
        setSelected((sel) => sel?.id === msg.session.id ? msg.session : sel);
        break;
      case "session_deleted":
        setSessions((s) => s.filter((x) => x.id !== msg.sessionId));
        setSelected((sel) => sel?.id === msg.sessionId ? null : sel);
        break;
    }
  }, []));

  function handleSelect(s: Session) {
    setSelected(s);
  }

  return (
    <div className="app">
      {/* Header — hidden when session detail has its own header */}
      {!selected && (
        <div className="header">
          <h1>Agent Harness</h1>
          <div
            className={`conn-dot ${connected ? "connected" : "disconnected"}`}
            title={connected ? "Connected" : "Disconnected"}
          />
        </div>
      )}

      {/* Main content */}
      <div className="main">
        {selected ? (
          <SessionDetail
            session={selected}
            onBack={() => setSelected(null)}
            onUpdate={(s) => setSessions((ss) => ss.map((x) => x.id === s.id ? s : x))}
          />
        ) : (
          <>
            {tab === "sessions" && (
              <SessionsList
                sessions={sessions}
                onSelect={handleSelect}
                onNew={() => setShowNew(true)}
              />
            )}
            {tab === "stats" && <StatsView />}
          </>
        )}
      </div>

      {/* Tab bar (hidden when in session detail) */}
      {!selected && (
        <nav className="tab-bar">
          <button className={`tab-btn ${tab === "sessions" ? "active" : ""}`} onClick={() => setTab("sessions")}>
            <Icons.sessions />
            Sessions
          </button>
          <button className={`tab-btn ${tab === "stats" ? "active" : ""}`} onClick={() => setTab("stats")}>
            <Icons.stats />
            Stats
          </button>
        </nav>
      )}

      {showNew && (
        <NewSessionModal
          onClose={() => setShowNew(false)}
          onCreated={(s) => {
            setSessions((ss) => [s, ...ss]);
            toast(`Session "${s.name}" created`);
          }}
        />
      )}
    </div>
  );
}

// Mount
const root = createRoot(document.getElementById("root")!);
root.render(<ToastProvider><App /></ToastProvider>);
