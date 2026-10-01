import { sessionManager } from "../session/index.js"
import { rateLimiter } from "../../utils/rate-limiter.js"
import type { SendMessagePayload } from "../../schemas/index.js"
import { logger } from "../../utils/logger.js"

export const messageService = {
  async send(payload: SendMessagePayload): Promise<{ id: string }> {
    const check = rateLimiter.check(payload.sessionId)
    if (!check.allowed) {
      throw new Error(check.reason)
    }

    const delay = rateLimiter.getNextDelay(payload.sessionId)
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay))
    }

    logger.info(
      { sessionId: payload.sessionId, to: payload.to },
      "Sending message"
    )

    const result = await sessionManager.sendMessage(payload)
    rateLimiter.record(payload.sessionId)

    return result
  },
}
