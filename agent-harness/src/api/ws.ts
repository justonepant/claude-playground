import type { ServerWebSocket } from "bun";

type WSData = { sessionId?: string };
type Client = ServerWebSocket<WSData>;

const clients = new Set<Client>();

export function registerClient(ws: Client) {
  clients.add(ws);
}

export function unregisterClient(ws: Client) {
  clients.delete(ws);
}

export function broadcast(payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

export function broadcastToSession(sessionId: string, payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState !== 1) continue;
    if (!ws.data.sessionId || ws.data.sessionId === sessionId) {
      ws.send(msg);
    }
  }
}
