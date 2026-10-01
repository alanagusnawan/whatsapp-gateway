import type { GatewayEvent } from "../schemas/index.js"
import { eventBus } from "./emitter.js"
import { logger } from "../utils/logger.js"

export interface WsClient {
  send(data: string): void
  close?(code?: number, reason?: string): void
  ping?(data?: unknown): void
}

class WsHub {
  private peers = new Map<WsClient, string | null>()
  private heartbeat: ReturnType<typeof setInterval> | null = null

  add(client: WsClient, sessionId?: string) {
    this.peers.set(client, sessionId || null)
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.heartbeatTick(), 30_000)
      this.heartbeat.unref?.()
    }
    logger.debug({ sessionId, total: this.peers.size }, "WS client connected")
  }

  remove(client: WsClient) {
    const sessionId = this.peers.get(client)
    this.peers.delete(client)
    if (this.peers.size === 0 && this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    logger.debug({ sessionId, total: this.peers.size }, "WS client disconnected")
  }

  subscribe(client: WsClient, sessionId: string) {
    if (!this.peers.has(client)) return
    this.peers.set(client, sessionId)
  }

  unsubscribe(client: WsClient) {
    if (!this.peers.has(client)) return
    this.peers.set(client, null)
  }

  broadcast(event: GatewayEvent) {
    const data = JSON.stringify(event)
    for (const [client, sessionId] of this.peers) {
      if (sessionId !== null && sessionId !== event.sessionId) continue
      try {
        client.send(data)
      } catch (err) {
        logger.debug({ err }, "WS send failed, dropping client")
        this.peers.delete(client)
      }
    }
  }

  private heartbeatTick() {
    for (const client of this.peers.keys()) {
      try {
        client.ping?.()
      } catch {
        this.peers.delete(client)
      }
    }
  }

  get clientCount(): number {
    return this.peers.size
  }
}

export const wsHub = new WsHub()

eventBus.on("gateway_event", (event: GatewayEvent) => {
  wsHub.broadcast(event)
})
