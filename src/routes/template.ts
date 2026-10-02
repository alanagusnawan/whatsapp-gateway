import { Elysia, t } from "elysia"
import { authGuard } from "../plugins/auth.js"
import { templateService } from "../services/template/index.js"
import { TEMPLATE_CATEGORIES, TEMPLATE_TONES } from "../services/template/constants.js"

const DEFAULT_CREATED_BY = "api"

function createdByFrom(headers: Record<string, string | undefined>): string {
  return headers["x-created-by"]?.trim() || headers["X-Created-By"]?.trim() || DEFAULT_CREATED_BY
}

function mapError(
  err: unknown,
  set: { status?: number | string }
): { success: false; error: string } {
  const message = err instanceof Error ? err.message : "Terjadi kesalahan pada server."

  if (message.includes("tidak ditemukan")) set.status = 404
  else if (message.includes("per menit tercapai")) set.status = 429
  else if (message.includes("belum dikonfigurasi")) set.status = 503
  else if (
    message.includes("tidak valid") ||
    message.includes("wajib") ||
    message.includes("maksimal") ||
    message.includes("minimal") ||
    message.includes("Pilihan:")
  )
    set.status = 400
  else if (
    message.includes("Gemini") ||
    message.includes("Gagal terhubung") ||
    message.includes("melebihi batas waktu")
  )
    set.status = 502
  else set.status = 500

  return { success: false, error: message }
}

export const templateRoutes = new Elysia({ prefix: "/message-templates" })
  .onBeforeHandle(authGuard)
  .onError(({ code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400
      return { success: false, error: "Format permintaan tidak valid. Periksa kembali field yang dikirim." }
    }
  })
  .get("/categories", () => ({
    success: true,
    categories: TEMPLATE_CATEGORIES,
    tones: TEMPLATE_TONES,
  }))
  .post(
    "/generate",
    async ({ body, set }) => {
      try {
        const draft = await templateService.generate({
          category: body.category,
          tone: body.tone,
          purpose: body.purpose,
          additionalInstructions: body.additionalInstructions,
          context: body.context,
        })
        return { success: true, draft }
      } catch (err) {
        return mapError(err, set)
      }
    },
    {
      body: t.Object({
        category: t.String(),
        tone: t.String(),
        purpose: t.String(),
        additionalInstructions: t.Optional(t.String()),
        context: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const { templates, total } = await templateService.list(query as Record<string, string>)
        return { success: true, templates, total }
      } catch (err) {
        return mapError(err, set)
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        category: t.Optional(t.String()),
        tone: t.Optional(t.String()),
        active: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/",
    async ({ body, headers, set }) => {
      try {
        const template = await templateService.create({
          name: body.name,
          category: body.category,
          tone: body.tone,
          content: body.content,
          purpose: body.purpose,
          additionalInstructions: body.additionalInstructions,
          isActive: body.isActive,
          createdBy: createdByFrom(headers),
        })
        return { success: true, template }
      } catch (err) {
        return mapError(err, set)
      }
    },
    {
      body: t.Object({
        name: t.String(),
        category: t.String(),
        tone: t.String(),
        content: t.String(),
        purpose: t.Optional(t.String()),
        additionalInstructions: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
      }),
    }
  )
  .get("/:id", async ({ params, set }) => {
    try {
      const template = await templateService.getById(params.id)
      return { success: true, template }
    } catch (err) {
      return mapError(err, set)
    }
  })
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const template = await templateService.update(params.id, body)
        return { success: true, template }
      } catch (err) {
        return mapError(err, set)
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        category: t.Optional(t.String()),
        tone: t.Optional(t.String()),
        content: t.Optional(t.String()),
        purpose: t.Optional(t.String()),
        additionalInstructions: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
      }),
    }
  )
  .delete("/:id", async ({ params, set }) => {
    try {
      await templateService.delete(params.id)
      return { success: true, message: "Template pesan dihapus" }
    } catch (err) {
      return mapError(err, set)
    }
  })
  .post("/:id/duplicate", async ({ params, headers, set }) => {
    try {
      const template = await templateService.duplicate(params.id, createdByFrom(headers))
      return { success: true, template }
    } catch (err) {
      return mapError(err, set)
    }
  })
