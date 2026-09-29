import { Elysia, t } from "elysia"
import { sessionManager } from "../services/session"

export const chatRoutes = new Elysia({ prefix: "/chats" })
  .get("/:sessionId", async ({ params }) => {
    const { chatStore } = await import("../storage/chat-store")
    const chats = await chatStore.getAll(params.sessionId)
    return { success: true, chats }
  })
  .get("/:sessionId/:chatJid/messages", async ({ params, query }) => {
    const { messageStore } = await import("../storage/message-store")
    const limit = parseInt((query as any).limit || "50")
    const offset = parseInt((query as any).offset || "0")
    const messages = await messageStore.getByChat(params.sessionId, params.chatJid, limit, offset)
    return { success: true, messages }
  })
  .get("/:sessionId/stats", async ({ params }) => {
    const { chatStore } = await import("../storage/chat-store")
    const { contactStore } = await import("../storage/contact-store")
    const { messageStore } = await import("../storage/message-store")
    const chatCount = await chatStore.count(params.sessionId)
    const contactCount = await contactStore.count(params.sessionId)
    const messageCount = await messageStore.count(params.sessionId)
    const perChat = await messageStore.countByChat(params.sessionId)
    return {
      success: true,
      stats: {
        chats: chatCount,
        contacts: contactCount,
        messages: messageCount,
        perChat: perChat.sort((a, b) => b.count - a.count).slice(0, 20),
      },
    }
  })
  .get("/:sessionId/:chatJid/profile", async ({ params, set }) => {
    try {
      const url = await sessionManager.getProfilePicture(params.sessionId, params.chatJid)
      return { success: true, url }
    } catch (err: any) {
      set.status = err.message?.includes("not found") ? 404 : 500
      return { success: false, error: err.message }
    }
  })
  .post(
    "/archive",
    async ({ body, set }) => {
      try {
        await sessionManager.archiveChat(body.sessionId, body.chatJid, body.archive)
        return { success: true, message: body.archive ? "Chat archived" : "Chat unarchived" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), chatJid: t.String(), archive: t.Boolean() }) }
  )
  .post(
    "/mute",
    async ({ body, set }) => {
      try {
        await sessionManager.muteChat(body.sessionId, body.chatJid, body.durationMs ?? null)
        return { success: true, message: body.durationMs ? "Chat muted" : "Chat unmuted" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), chatJid: t.String(), durationMs: t.Optional(t.Number()) }) }
  )
  .post(
    "/pin",
    async ({ body, set }) => {
      try {
        await sessionManager.pinChat(body.sessionId, body.chatJid, body.pin)
        return { success: true, message: body.pin ? "Chat pinned" : "Chat unpinned" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), chatJid: t.String(), pin: t.Boolean() }) }
  )
  .post(
    "/delete",
    async ({ body, set }) => {
      try {
        await sessionManager.deleteChat(body.sessionId, body.chatJid)
        return { success: true, message: "Chat deleted" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), chatJid: t.String() }) }
  )
  .post(
    "/star",
    async ({ body, set }) => {
      try {
        await sessionManager.starMessage(body.sessionId, body.chatJid, body.messageId, body.fromMe, body.star)
        return { success: true, message: body.star ? "Message starred" : "Message unstarred" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), chatJid: t.String(), messageId: t.String(), fromMe: t.Boolean(), star: t.Boolean() }) }
  )
  .post(
    "/profile-name",
    async ({ body, set }) => {
      try {
        await sessionManager.updateProfileName(body.sessionId, body.name)
        return { success: true, message: "Profile name updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), name: t.String() }) }
  )
  .post(
    "/profile-status",
    async ({ body, set }) => {
      try {
        await sessionManager.updateProfileStatus(body.sessionId, body.status)
        return { success: true, message: "Profile status updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), status: t.String() }) }
  )
  .post(
    "/fetch-history",
    async ({ body, set }) => {
      try {
        await sessionManager.fetchMessageHistory(body.sessionId, body.count, body.oldestMsgKey, body.oldestMsgTimestamp)
        return { success: true, message: "History fetch requested" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    {
      body: t.Object({
        sessionId: t.String(),
        count: t.Number(),
        oldestMsgKey: t.Any(),
        oldestMsgTimestamp: t.Number(),
      }),
    }
  )
