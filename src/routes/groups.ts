import { Elysia, t } from "elysia"
import { sessionManager } from "../services/session"

export const groupRoutes = new Elysia({ prefix: "/groups" })
  .post(
    "/create",
    async ({ body, set }) => {
      try {
        const result = await sessionManager.groupCreate(body.sessionId, body.subject, body.participants)
        return { success: true, gid: result.gid }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), subject: t.String(), participants: t.Array(t.String()) }) }
  )
  .get("/:sessionId/:jid/metadata", async ({ params, set }) => {
    try {
      const metadata = await sessionManager.groupMetadata(params.sessionId, params.jid)
      return { success: true, metadata }
    } catch (err: any) {
      set.status = err.message?.includes("not found") ? 404 : 500
      return { success: false, error: err.message }
    }
  })
  .post(
    "/participants",
    async ({ body, set }) => {
      try {
        const result = await sessionManager.groupParticipantsUpdate(body.sessionId, body.jid, body.participants, body.action)
        return { success: true, result }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String(), participants: t.Array(t.String()), action: t.Union([t.Literal("add"), t.Literal("remove"), t.Literal("promote"), t.Literal("demote")]) }) }
  )
  .post(
    "/subject",
    async ({ body, set }) => {
      try {
        await sessionManager.groupUpdateSubject(body.sessionId, body.jid, body.subject)
        return { success: true, message: "Subject updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String(), subject: t.String() }) }
  )
  .post(
    "/description",
    async ({ body, set }) => {
      try {
        await sessionManager.groupUpdateDescription(body.sessionId, body.jid, body.description)
        return { success: true, message: "Description updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String(), description: t.String() }) }
  )
  .post(
    "/settings",
    async ({ body, set }) => {
      try {
        await sessionManager.groupSettingUpdate(body.sessionId, body.jid, body.setting)
        return { success: true, message: "Settings updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String(), setting: t.Union([t.Literal("announcement"), t.Literal("not_announcement"), t.Literal("locked"), t.Literal("unlocked")]) }) }
  )
  .post(
    "/leave",
    async ({ body, set }) => {
      try {
        await sessionManager.groupLeave(body.sessionId, body.jid)
        return { success: true, message: "Left group" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String() }) }
  )
  .get("/:sessionId/:jid/invite", async ({ params, set }) => {
    try {
      const code = await sessionManager.groupInviteCode(params.sessionId, params.jid)
      return { success: true, code, link: `https://chat.whatsapp.com/${code}` }
    } catch (err: any) {
      set.status = err.message?.includes("not found") ? 404 : 400
      return { success: false, error: err.message }
    }
  })
  .post(
    "/invite/revoke",
    async ({ body, set }) => {
      try {
        const code = await sessionManager.groupRevokeInvite(body.sessionId, body.jid)
        return { success: true, code, link: `https://chat.whatsapp.com/${code}` }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String() }) }
  )
  .post(
    "/invite/join",
    async ({ body, set }) => {
      try {
        const gid = await sessionManager.groupAcceptInvite(body.sessionId, body.code)
        return { success: true, gid }
      } catch (err: any) {
        set.status = 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), code: t.String() }) }
  )
  .get(
    "/invite/info/:sessionId/:code",
    async ({ params, set }) => {
      try {
        const info = await sessionManager.groupGetInviteInfo(params.sessionId, params.code)
        return { success: true, info }
      } catch (err: any) {
        set.status = 400
        return { success: false, error: err.message }
      }
    }
  )
  .post(
    "/ephemeral",
    async ({ body, set }) => {
      try {
        await sessionManager.groupToggleEphemeral(body.sessionId, body.jid, body.duration)
        return { success: true, message: "Ephemeral updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String(), duration: t.Number() }) }
  )
  .post(
    "/member-add-mode",
    async ({ body, set }) => {
      try {
        await sessionManager.groupMemberAddMode(body.sessionId, body.jid, body.mode)
        return { success: true, message: "Member add mode updated" }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String(), mode: t.Union([t.Literal("all_member_add"), t.Literal("admin_add")]) }) }
  )
  .get("/:sessionId/all", async ({ params, set }) => {
    try {
      const groups = await sessionManager.groupFetchAllParticipating(params.sessionId)
      return { success: true, groups }
    } catch (err: any) {
      set.status = err.message?.includes("not found") ? 404 : 500
      return { success: false, error: err.message }
    }
  })
  .get("/:sessionId/:jid/requests", async ({ params, set }) => {
    try {
      const requests = await sessionManager.groupRequestParticipantsList(params.sessionId, params.jid)
      return { success: true, requests }
    } catch (err: any) {
      set.status = err.message?.includes("not found") ? 404 : 500
      return { success: false, error: err.message }
    }
  })
  .post(
    "/requests",
    async ({ body, set }) => {
      try {
        const result = await sessionManager.groupRequestParticipantsUpdate(body.sessionId, body.jid, body.participants, body.action)
        return { success: true, result }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    { body: t.Object({ sessionId: t.String(), jid: t.String(), participants: t.Array(t.String()), action: t.Union([t.Literal("approve"), t.Literal("reject")]) }) }
  )
