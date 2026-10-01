import { sessionManager } from "../session/index.js"
import { rateLimiter } from "../../utils/rate-limiter.js"
import { messageStore } from "../../storage/message-store.js"
import { chatStore } from "../../storage/chat-store.js"
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

    // Persist pesan keluar ke DB agar sinkron di semua device
    const chatJid = payload.to.includes("@")
      ? payload.to
      : `${payload.to.replace(/[^0-9]/g, "")}@s.whatsapp.net`
    const text = payload.text || payload.caption || ""
    const timestamp = Math.floor(Date.now() / 1000)
    try {
      await messageStore.insert(payload.sessionId, {
        messageId: result.id,
        chatJid,
        fromJid: chatJid,
        fromMe: true,
        type: payload.mediaType || "text",
        text,
        timestamp,
        raw: null,
      })
      await chatStore.updateLastMessage(payload.sessionId, chatJid, text, timestamp)
      if (!chatJid.endsWith("@g.us")) {
        await chatStore.updatePhone(payload.sessionId, chatJid, payload.to.replace(/[^0-9]/g, ""))
      }
    } catch (err) {
      logger.debug({ err, sessionId: payload.sessionId }, "Failed to persist outgoing message")
    }

    return result
  },
}
