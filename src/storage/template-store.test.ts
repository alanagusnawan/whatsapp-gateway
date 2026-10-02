import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { initDb, closeDb, getDb } from "./postgres.js"
import { templateStore } from "./template-store.js"

const createdIds: string[] = []

async function createTracked(data: Parameters<typeof templateStore.create>[0]) {
  const template = await templateStore.create(data)
  createdIds.push(template.id)
  return template
}

describe("templateStore (integrasi PostgreSQL)", () => {
  beforeAll(async () => {
    await initDb()
  })

  afterAll(async () => {
    const sql = getDb()
    if (createdIds.length > 0) {
      await sql`DELETE FROM message_templates WHERE id = ANY(${createdIds}::text[])`
    }
    await sql`DELETE FROM message_templates WHERE created_by = 'store-test'`
    await closeDb()
  })

  it("create lalu getById mengembalikan data domain camelCase", async () => {
    const created = await createTracked({
      name: "Sapaan Pasien Baru",
      category: "sapaan_pasien_baru",
      tone: "formal",
      content: "Selamat pagi {{nama_pasien}}, selamat datang di {{nama_poli}}.",
      purpose: "Menyapa pasien baru",
      createdBy: "store-test",
    })

    expect(created.id).toHaveLength(8)
    expect(created.isActive).toBe(true)
    expect(created.createdBy).toBe("store-test")
    expect(created.purpose).toBe("Menyapa pasien baru")
    expect(created.createdAt).toBeTruthy()
    expect(created.updatedAt).toBeTruthy()

    const fetched = await templateStore.getById(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.name).toBe("Sapaan Pasien Baru")
  })

  it("getById mengembalikan null untuk id yang tidak ada", async () => {
    expect(await templateStore.getById("tidakada")).toBeNull()
  })

  it("list mendukung filter kategori, tone, active, q, limit, offset, dan total", async () => {
    await createTracked({
      name: "Promo Medical Checkup",
      category: "promo_dan_acara",
      tone: "friendly",
      content: "Halo, kami punya promo medical checkup bulan ini.",
      createdBy: "store-test",
    })
    await createTracked({
      name: "Pengingat Kunjungan",
      category: "pengingat_kunjungan",
      tone: "singkat",
      content: "Pengingat kunjungan besok.",
      isActive: false,
      createdBy: "store-test",
    })

    const byCategory = await templateStore.list({
      category: "promo_dan_acara",
      limit: 50,
      offset: 0,
    })
    expect(byCategory.templates.length).toBeGreaterThanOrEqual(1)
    expect(byCategory.templates.every((t) => t.category === "promo_dan_acara")).toBe(true)
    expect(byCategory.total).toBe(byCategory.templates.length)

    const byTone = await templateStore.list({ tone: "singkat", limit: 50, offset: 0 })
    expect(byTone.templates.every((t) => t.tone === "singkat")).toBe(true)

    const inactive = await templateStore.list({ active: false, limit: 50, offset: 0 })
    expect(inactive.templates.length).toBeGreaterThanOrEqual(1)
    expect(inactive.templates.every((t) => t.isActive === false)).toBe(true)

    const byQuery = await templateStore.list({ q: "medical checkup", limit: 50, offset: 0 })
    expect(byQuery.templates.some((t) => t.name === "Promo Medical Checkup")).toBe(true)

    const paged = await templateStore.list({ limit: 1, offset: 0 })
    expect(paged.templates.length).toBeLessThanOrEqual(1)
    expect(paged.total).toBeGreaterThanOrEqual(3)
  })

  it("update memperbarui field dan mengembalikan row terbaru", async () => {
    const created = await createTracked({
      name: "Template Edit",
      category: "lainnya",
      tone: "ramah",
      content: "Isi awal",
      createdBy: "store-test",
    })

    const updated = await templateStore.update(created.id, {
      content: "Isi baru",
      isActive: false,
    })

    expect(updated?.content).toBe("Isi baru")
    expect(updated?.isActive).toBe(false)

    const untouched = await templateStore.update("tidakada", { isActive: false })
    expect(untouched).toBeNull()
  })

  it("delete mengembalikan true hanya untuk baris yang ada", async () => {
    const created = await createTracked({
      name: "Template Hapus",
      category: "lainnya",
      tone: "formal",
      content: "Isi",
      createdBy: "store-test",
    })

    expect(await templateStore.delete(created.id)).toBe(true)
    expect(await templateStore.delete(created.id)).toBe(false)
  })
})
