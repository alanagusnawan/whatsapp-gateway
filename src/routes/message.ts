import { Elysia, t } from "elysia"
import { messageService } from "../services/message/index.js"
import { sessionManager } from "../services/session/index.js"

const messageBody = t.Object({
  sessionId: t.String(),
  to: t.String(),
  text: t.Optional(t.String()),
  mediaUrl: t.Optional(t.String()),
  mediaType: t.Optional(t.Union([
    t.Literal("image"), t.Literal("video"),
    t.Literal("document"), t.Literal("audio"),
  ])),
  caption: t.Optional(t.String()),
  location: t.Optional(t.Object({ lat: t.Number(), lng: t.Number() })),
  reaction: t.Optional(t.Object({ text: t.String(), messageId: t.String() })),
  poll: t.Optional(t.Object({
    name: t.String(),
    values: t.Array(t.String()),
    selectableCount: t.Number(),
  })),
  contacts: t.Optional(t.Object({
    displayName: t.String(),
    contacts: t.Array(t.Object({
      name: t.String(),
      phone: t.String(),
      organization: t.Optional(t.String()),
    })),
  })),
  pin: t.Optional(t.Object({
    messageId: t.String(),
    type: t.Union([t.Literal(0), t.Literal(1)]),
    time: t.Optional(t.Number()),
  })),
  forward: t.Optional(t.Object({ messageId: t.String(), chatJid: t.String() })),
  disappearingMessages: t.Optional(t.Object({
    enabled: t.Boolean(),
    duration: t.Optional(t.Number()),
  })),
  mentions: t.Optional(t.Array(t.String())),
  quoted: t.Optional(t.Object({ messageId: t.String(), chatJid: t.String() })),
  ephemeralExpiration: t.Optional(t.Number()),
})

export const messageRoutes = new Elysia({ prefix: "/message" })
  .get(
    "/check/:sessionId/:phone",
    async ({ params, set }) => {
      const phone = params.phone.replace(/[^0-9]/g, "")
      if (phone.length < 10 || phone.length > 15) {
        set.status = 400
        return { success: false, error: "Invalid phone number format" }
      }
      try {
        const exists = await sessionManager.isRegistered(params.sessionId, phone)
        return { success: true, phone, exists }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    }
  )
  .post(
    "/send",
    async ({ body, set }) => {
      const to = body.to.replace(/[^0-9]/g, "")
      if (to.length < 10 || to.length > 15) {
        set.status = 400
        return { success: false, error: "Invalid phone number (10-15 digits)" }
      }

      const hasContent = body.text || body.mediaUrl || body.location ||
        body.reaction || body.poll || body.contacts || body.pin ||
        body.forward || body.disappearingMessages
      if (!hasContent) {
        set.status = 400
        return { success: false, error: "No message content provided" }
      }

      if (body.text && body.text.length > 4096) {
        set.status = 400
        return { success: false, error: "Message too long (max 4096 characters)" }
      }

      if (body.text && body.mentions && body.mentions.length > 0) {
        const mentions = body.mentions.map((m) => m.replace(/[^0-9]/g, ""))
        body.text = mentions.map((m) => `@${m}`).join(" ") + " " + body.text
        body.mentions = mentions
      }

      try {
        const isRegistered = await sessionManager.isRegistered(body.sessionId, to)
        if (!isRegistered) {
          set.status = 400
          return { success: false, error: `Phone ${to} is not on WhatsApp` }
        }
      } catch (err: any) {
        set.status = 500
        return { success: false, error: err.message }
      }

      try {
        const result = await messageService.send({ ...body, to })
        return { success: true, messageId: result.id }
      } catch (err: any) {
        if (err.message?.includes("not found")) set.status = 404
        else if (err.message?.includes("not connected")) set.status = 503
        else if (err.message?.includes("Rate limit") || err.message?.includes("Wait")) set.status = 429
        else set.status = 500
        return { success: false, error: err.message }
      }
    },
    { body: messageBody }
  )
  .post(
    "/delete",
    async ({ body, set }) => {
      try {
        await sessionManager.deleteMessage(body.sessionId, body.chatJid, body.messageId)
        return { success: true, message: "Message deleted" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    {
      body: t.Object({
        sessionId: t.String(),
        chatJid: t.String(),
        messageId: t.String(),
      }),
    }
  )
  .post(
    "/edit",
    async ({ body, set }) => {
      try {
        await sessionManager.editMessage(body.sessionId, body.chatJid, body.messageId, body.text)
        return { success: true, message: "Message edited" }
      } catch (err: any) {
        set.status = err.message?.includes("not supported") ? 400 : err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    {
      body: t.Object({
        sessionId: t.String(),
        chatJid: t.String(),
        messageId: t.String(),
        text: t.String(),
      }),
    }
  )
  .post(
    "/read",
    async ({ body, set }) => {
      try {
        await sessionManager.markRead(body.sessionId, body.chatJid, body.messageIds)
        return { success: true, message: "Marked as read" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    {
      body: t.Object({
        sessionId: t.String(),
        chatJid: t.String(),
        messageIds: t.Array(t.String()),
      }),
    }
  )
  .post(
    "/presence",
    async ({ body, set }) => {
      try {
        await sessionManager.sendPresence(body.sessionId, body.chatJid, body.presence)
        return { success: true, message: "Presence updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    {
      body: t.Object({
        sessionId: t.String(),
        chatJid: t.String(),
        presence: t.Union([
          t.Literal("available"),
          t.Literal("unavailable"),
          t.Literal("composing"),
          t.Literal("recording"),
          t.Literal("paused"),
        ]),
      }),
    }
  )
  .post(
    "/presence/subscribe",
    async ({ body, set }) => {
      try {
        await sessionManager.presenceSubscribe(body.sessionId, body.chatJid)
        return { success: true, message: "Subscribed to presence updates" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    {
      body: t.Object({
        sessionId: t.String(),
        chatJid: t.String(),
      }),
    }
  )
  .post(
    "/download",
    async ({ body, set }) => {
      try {
        const media = await sessionManager.downloadMedia(body.sessionId, body.msg, body.type)
        if (body.type === "buffer") {
          return { success: true, data: media.toString("base64") }
        }
        return { success: true, data: media }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    {
      body: t.Object({
        sessionId: t.String(),
        msg: t.Any(),
        type: t.Optional(t.Union([t.Literal("buffer"), t.Literal("stream")])),
      }),
    }
  )
