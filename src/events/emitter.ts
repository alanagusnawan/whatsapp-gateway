import { EventEmitter } from "node:events"
import type { GatewayEvent } from "../types"
import { logger } from "../utils/logger"

class EventBus extends EventEmitter {
  private _sseClients = new Set<ReadableStreamDefaultController>()

  get sseClientCount(): number {
    return this._sseClients.size
  }

  broadcast(event: GatewayEvent) {
    this.emit("gateway_event", event)

    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const controller of this._sseClients) {
      try {
        controller.enqueue(new TextEncoder().encode(data))
      } catch {
        this._sseClients.delete(controller)
      }
    }
  }

  addSSEClient(controller: ReadableStreamDefaultController) {
    this._sseClients.add(controller)
    logger.debug(
      { total: this._sseClients.size },
      "SSE client connected"
    )
  }

  removeSSEClient(controller: ReadableStreamDefaultController) {
    this._sseClients.delete(controller)
    logger.debug(
      { total: this._sseClients.size },
      "SSE client disconnected"
    )
  }
}

export const eventBus = new EventBus()
