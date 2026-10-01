import { Elysia, t } from "elysia"
import { webhookStore } from "../storage/webhook-store.js"
import type { WebhookEvent } from "../schemas/index.js"

export const webhookRoutes = new Elysia({ prefix: "/webhook" })
  .post(
    "/",
    async ({ body }) => {
      const webhook = await webhookStore.create(
        body.url,
        body.events as WebhookEvent[],
        body.secret
      )
      return { success: true, webhook }
    },
    {
      body: t.Object({
        url: t.String(),
        events: t.Array(t.String()),
        secret: t.Optional(t.String()),
      }),
    }
  )
  .get("/", async () => {
    const webhooks = await webhookStore.getAll()
    return { success: true, webhooks }
  })
  .get("/:id", async ({ params, set }) => {
    const webhook = await webhookStore.getById(params.id)
    if (!webhook) {
      set.status = 404
      return { success: false, error: "Webhook not found" }
    }
    return { success: true, webhook }
  })
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      const webhook = await webhookStore.update(params.id, {
        url: body.url,
        events: body.events as WebhookEvent[],
        active: body.active,
      })
      if (!webhook) {
        set.status = 404
        return { success: false, error: "Webhook not found" }
      }
      return { success: true, webhook }
    },
    {
      body: t.Object({
        url: t.Optional(t.String()),
        events: t.Optional(t.Array(t.String())),
        active: t.Optional(t.Boolean()),
      }),
    }
  )
  .delete("/:id", async ({ params, set }) => {
    const deleted = await webhookStore.delete(params.id)
    if (!deleted) {
      set.status = 404
      return { success: false, error: "Webhook not found" }
    }
    return { success: true, message: "Webhook deleted" }
  })
