import { Elysia, t } from "elysia"
import { sessionManager } from "../services/session"

export const privacyRoutes = new Elysia({ prefix: "/privacy" })
  .get("/:sessionId", async ({ params, set }) => {
    try {
      const settings = await sessionManager.fetchPrivacySettings(params.sessionId, true)
      return { success: true, settings }
    } catch (err: any) {
      set.status = err.message?.includes("not found") ? 404 : 500
      return { success: false, error: err.message }
    }
  })
  .get("/:sessionId/blocklist", async ({ params, set }) => {
    try {
      const blocklist = await sessionManager.fetchBlocklist(params.sessionId)
      return { success: true, blocklist }
    } catch (err: any) {
      set.status = err.message?.includes("not found") ? 404 : 500
      return { success: false, error: err.message }
    }
  })
  .post(
    "/block",
    async ({ body, set }) => {
      try {
        await sessionManager.updateBlockStatus(body.sessionId, body.jid, "block")
        return { success: true, message: "User blocked" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String() }) }
  )
  .post(
    "/unblock",
    async ({ body, set }) => {
      try {
        await sessionManager.updateBlockStatus(body.sessionId, body.jid, "unblock")
        return { success: true, message: "User unblocked" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String() }) }
  )
  .post(
    "/last-seen",
    async ({ body, set }) => {
      try {
        await sessionManager.updateLastSeenPrivacy(body.sessionId, body.value)
        return { success: true, message: "Last seen privacy updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), value: t.Union([t.Literal("all"), t.Literal("contacts"), t.Literal("contact_blacklist"), t.Literal("none")]) }) }
  )
  .post(
    "/online",
    async ({ body, set }) => {
      try {
        await sessionManager.updateOnlinePrivacy(body.sessionId, body.value)
        return { success: true, message: "Online privacy updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), value: t.Union([t.Literal("all"), t.Literal("match_last_seen")]) }) }
  )
  .post(
    "/profile-picture",
    async ({ body, set }) => {
      try {
        await sessionManager.updateProfilePicturePrivacy(body.sessionId, body.value)
        return { success: true, message: "Profile picture privacy updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), value: t.Union([t.Literal("all"), t.Literal("contacts"), t.Literal("contact_blacklist"), t.Literal("none")]) }) }
  )
  .post(
    "/status",
    async ({ body, set }) => {
      try {
        await sessionManager.updateStatusPrivacy(body.sessionId, body.value)
        return { success: true, message: "Status privacy updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), value: t.Union([t.Literal("all"), t.Literal("contacts"), t.Literal("contact_blacklist"), t.Literal("none")]) }) }
  )
  .post(
    "/read-receipts",
    async ({ body, set }) => {
      try {
        await sessionManager.updateReadReceiptsPrivacy(body.sessionId, body.value)
        return { success: true, message: "Read receipts privacy updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), value: t.Union([t.Literal("all"), t.Literal("none")]) }) }
  )
  .post(
    "/groups-add",
    async ({ body, set }) => {
      try {
        await sessionManager.updateGroupsAddPrivacy(body.sessionId, body.value)
        return { success: true, message: "Groups add privacy updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), value: t.Union([t.Literal("all"), t.Literal("contacts"), t.Literal("contact_blacklist")]) }) }
  )
  .post(
    "/disappearing-mode",
    async ({ body, set }) => {
      try {
        await sessionManager.updateDefaultDisappearingMode(body.sessionId, body.duration)
        return { success: true, message: "Default disappearing mode updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), duration: t.Number() }) }
  )
