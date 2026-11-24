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

    let type = payload.mediaType || "text"
    let text = payload.text || payload.caption || ""

    if (payload.poll) {
      type = "poll"
      text = `📊 ${payload.poll.name}\n${payload.poll.values.map((v, i) => `${i + 1}. ${v}`).join("\n")}`
    } else if (payload.location) {
      type = "location"
      text = `📍 https://maps.google.com/?q=${payload.location.lat},${payload.location.lng}`
    } else if (payload.contacts) {
      type = "contact"
      text = `👤 Kontak: ${payload.contacts.displayName}\n${payload.contacts.contacts.map((c) => `${c.name}: ${c.phone}`).join("\n")}`
    } else if (payload.pin) {
      type = "pin"
      text = payload.pin.type === 1 ? "📌 Pesan disematkan" : "📌 Sematan pesan dilepas"
    } else if (payload.disappearingMessages) {
      type = "protocol"
      text = payload.disappearingMessages.enabled
        ? `⏱️ Pesan sementara diaktifkan (${(payload.disappearingMessages.duration || 86400) / 86400} hari)`
        : "⏱️ Pesan sementara dimatikan"
    }

    const timestamp = Math.floor(Date.now() / 1000)
    try {
      let rawData: any = payload.poll ? { poll: payload.poll } : payload.location ? { location: payload.location } : null

      if (payload.quoted) {
        const origMsg = await messageStore.getById(payload.sessionId, payload.quoted.messageId)
        let quotedMessageContent = origMsg?.raw
        if (!quotedMessageContent || Object.keys(quotedMessageContent).length === 0) {
          quotedMessageContent = { conversation: origMsg?.text || payload.quoted.text || "" }
        }

        const contextInfo = {
          stanzaId: payload.quoted.messageId,
          participant: origMsg?.from_jid || origMsg?.chat_jid || payload.quoted.chatJid,
          quotedMessage: quotedMessageContent,
        }

        if (type === "text" || !type) {
          rawData = {
            extendedTextMessage: {
              text,
              contextInfo,
            },
          }
        } else if (rawData) {
          rawData.contextInfo = contextInfo
        } else {
          rawData = { contextInfo }
        }
      }

      await messageStore.insert(payload.sessionId, {
        messageId: result.id,
        chatJid,
        fromJid: chatJid,
        fromMe: true,
        type,
        text,
        timestamp,
        raw: rawData,
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
