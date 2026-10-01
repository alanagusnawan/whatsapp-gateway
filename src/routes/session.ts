import { Elysia, t } from "elysia"
import { sessionManager } from "../services/session/index.js"
import type { EngineType } from "../schemas/index.js"

export const sessionRoutes = new Elysia({ prefix: "/session" })
  .post(
    "/",
    async ({ body }) => {
      const session = await sessionManager.createSession(
        body.name,
        body.engine
      )

      sessionManager.connectSession(session.id).catch(() => {})

      return { success: true, session }
    },
    {
      body: t.Object({
        name: t.String(),
        engine: t.Union([t.Literal("baileys"), t.Literal("wwjs")]),
      }),
    }
  )
  .get("/", async () => {
    const sessions = await sessionManager.listSessions()
    return { success: true, sessions }
  })
  .get("/:id", async ({ params, set }) => {
    const session = await sessionManager.getSession(params.id)
    if (!session) {
      set.status = 404
      return { success: false, error: "Session not found" }
    }
    return { success: true, session }
  })
  .get("/:id/qr", ({ params, set }) => {
    const qr = sessionManager.getQr(params.id)
    if (!qr) {
      set.status = 404
      return { success: false, error: "QR not available" }
    }
    return { success: true, qr }
  })
  .post(
    "/:id/pairing",
    async ({ params, body, set }) => {
      try {
        const code = await sessionManager.requestPairingCode(params.id, body.phone)
        return { success: true, code }
      } catch (err: any) {
        set.status = err.message?.includes("not found") ? 404 : 400
        return { success: false, error: err.message }
      }
    },
    {
      body: t.Object({
        phone: t.String(),
      }),
    }
  )
  .post("/:id/connect", async ({ params, set }) => {
    try {
      await sessionManager.connectSession(params.id)
      return { success: true, message: "Connecting..." }
    } catch (err: any) {
      set.status = 404
      return { success: false, error: err.message }
    }
  })
  .post("/:id/disconnect", async ({ params, set }) => {
    try {
      await sessionManager.disconnectSession(params.id)
      return { success: true, message: "Disconnected" }
    } catch (err: any) {
      set.status = 404
      return { success: false, error: err.message }
    }
  })
  .delete("/:id", async ({ params, set }) => {
    try {
      await sessionManager.deleteSession(params.id)
      return { success: true, message: "Session deleted" }
    } catch (err: any) {
      set.status = 404
      return { success: false, error: err.message }
    }
  })
