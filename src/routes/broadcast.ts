import { Elysia, t } from "elysia"
import { sessionManager } from "../services/session"

export const broadcastRoutes = new Elysia({ prefix: "/broadcast" })
  .post(
    "/send",
    async ({ body, set }) => {
      try {
        const content: any = {}
        if (body.text) content.text = body.text
        if (body.mediaUrl && body.mediaType) {
          const isHttp = body.mediaUrl.startsWith("http")
          const mediaSource = isHttp ? { url: body.mediaUrl } : { url: `file://${body.mediaUrl}` }
          content[body.mediaType] = mediaSource
          if (body.caption) content.caption = body.caption
        }
        if (body.backgroundColor) content.backgroundColor = body.backgroundColor
        if (body.font) content.font = body.font

        const result = await sessionManager.sendBroadcast(body.sessionId, body.jid, content, {
          backgroundColor: body.backgroundColor,
          font: body.font,
        })
        return { success: true, messageId: result.id }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    {
      body: t.Object({
        sessionId: t.String(),
        jid: t.String(),
        text: t.Optional(t.String()),
        mediaUrl: t.Optional(t.String()),
        mediaType: t.Optional(t.Union([t.Literal("image"), t.Literal("video"), t.Literal("audio")])),
        caption: t.Optional(t.String()),
        backgroundColor: t.Optional(t.String()),
        font: t.Optional(t.Number()),
      }),
    }
  )
  .post(
    "/status",
    async ({ body, set }) => {
      try {
        const content: any = {}
        if (body.text) {
          content.text = body.text
          if (body.backgroundColor) content.backgroundColor = body.backgroundColor
          if (body.font) content.font = body.font
        }
        if (body.mediaUrl && body.mediaType) {
          const isHttp = body.mediaUrl.startsWith("http")
          const mediaSource = isHttp ? { url: body.mediaUrl } : { url: `file://${body.mediaUrl}` }
          content[body.mediaType] = mediaSource
          if (body.caption) content.caption = body.caption
        }

        const result = await sessionManager.sendStatus(body.sessionId, content, body.statusJidList, {
          backgroundColor: body.backgroundColor,
          font: body.font,
        })
        return { success: true, messageId: result.id }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    },
    {
      body: t.Object({
        sessionId: t.String(),
        statusJidList: t.Array(t.String()),
        text: t.Optional(t.String()),
        mediaUrl: t.Optional(t.String()),
        mediaType: t.Optional(t.Union([t.Literal("image"), t.Literal("video"), t.Literal("audio")])),
        caption: t.Optional(t.String()),
        backgroundColor: t.Optional(t.String()),
        font: t.Optional(t.Number()),
      }),
    }
  )
  .get(
    "/info/:sessionId/:jid",
    async ({ params, set }) => {
      try {
        const info = await sessionManager.getBroadcastListInfo(params.sessionId, params.jid)
        return { success: true, info }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 500
        return { success: false, error: err.message }
      }
    }
  )
