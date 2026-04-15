// Notification backends: ntfy (self-hosted or ntfy.sh) + PWA push placeholder

interface NotifyOptions {
  title: string;
  body: string;
  priority?: "low" | "default" | "high" | "urgent";
  tags?: string[];
}

const NTFY_URL = process.env.NTFY_URL; // e.g. https://ntfy.sh/my-harness-topic
const NTFY_TOKEN = process.env.NTFY_TOKEN; // optional Bearer token

export async function notify(opts: NotifyOptions): Promise<void> {
  if (!NTFY_URL) return;

  const headers: Record<string, string> = {
    "Title": opts.title,
    "Priority": opts.priority ?? "default",
    "Content-Type": "text/plain",
  };

  if (opts.tags?.length) headers["Tags"] = opts.tags.join(",");
  if (NTFY_TOKEN) headers["Authorization"] = `Bearer ${NTFY_TOKEN}`;

  try {
    await fetch(NTFY_URL, {
      method: "POST",
      headers,
      body: opts.body,
    });
  } catch (e) {
    console.warn("[notify] Failed to send:", e);
  }
}

export function notifySessionComplete(sessionName: string, exitCode: number) {
  return notify({
    title: exitCode === 0 ? `✓ ${sessionName} done` : `✗ ${sessionName} failed`,
    body: exitCode === 0
      ? `Session "${sessionName}" completed successfully.`
      : `Session "${sessionName}" exited with code ${exitCode}.`,
    priority: exitCode === 0 ? "default" : "high",
    tags: exitCode === 0 ? ["white_check_mark"] : ["x"],
  });
}

export function notifyBudgetExceeded(sessionName: string, costUsd: number) {
  return notify({
    title: `Budget exceeded: ${sessionName}`,
    body: `Session "${sessionName}" has used $${costUsd.toFixed(4)} USD.`,
    priority: "high",
    tags: ["warning", "moneybag"],
  });
}

export function notifyError(sessionName: string, message: string) {
  return notify({
    title: `Error: ${sessionName}`,
    body: message,
    priority: "urgent",
    tags: ["rotating_light"],
  });
}
