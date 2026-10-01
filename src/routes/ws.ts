import { Elysia, t } from "elysia"
import { wsHub } from "../events/ws-hub.js"

// Function plugin: .ws() harus dipanggil di instance utama agar adapter
// (@elysiajs/node) yang punya WS support yang mendaftarkan route-nya.
export const wsRoutes = (app: Elysia) =>
  app.ws("/ws", {
    query: t.Object({
      sessionId: t.Optional(t.String()),
      apiKey: t.Optional(t.String()),
    }),
    open(ws) {
      const sessionId = (ws.data?.query as any)?.sessionId
      wsHub.add(ws, sessionId || undefined)
      ws.send(JSON.stringify({ type: "connected", sessionId: sessionId || null }))
    },
    message(ws, message) {
      let msg: any
      try {
        msg = typeof message === "string" ? JSON.parse(message) : message
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "Invalid JSON" }))
        return
      }

      if (!msg || typeof msg.type !== "string") {
        ws.send(JSON.stringify({ type: "error", error: "Expected { type: 'subscribe'|'unsubscribe', sessionId? }" }))
        return
      }

      if (msg.type === "subscribe") {
        if (typeof msg.sessionId !== "string" || !msg.sessionId) {
          ws.send(JSON.stringify({ type: "error", error: "sessionId required for subscribe" }))
          return
        }
        wsHub.subscribe(ws, msg.sessionId)
        ws.send(JSON.stringify({ type: "subscribed", sessionId: msg.sessionId }))
      } else if (msg.type === "unsubscribe") {
        wsHub.unsubscribe(ws)
        ws.send(JSON.stringify({ type: "subscribed", sessionId: null }))
      } else {
        ws.send(JSON.stringify({ type: "error", error: `Unknown type '${msg.type}'` }))
      }
    },
    close(ws) {
      wsHub.remove(ws)
    },
  })
