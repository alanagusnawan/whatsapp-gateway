import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { Elysia } from "elysia"
import { authPlugin } from "../plugins/auth.js"
import { errorPlugin } from "../plugins/error.js"
import { templateRoutes } from "./template.js"
import { config } from "../config/index.js"
import { initDb, closeDb, getDb } from "../storage/postgres.js"

const cfg = config as unknown as {
  apiKey: string
  gemini: { apiKey: string }
  template: { maxPerMinute: number }
}

const original = {
  apiKey: cfg.apiKey,
  geminiApiKey: cfg.gemini.apiKey,
  maxPerMinute: cfg.template.maxPerMinute,
}

const app = new Elysia().use(errorPlugin).use(authPlugin).use(templateRoutes)

function req(path: string, init: RequestInit = {}, withKey = true): Promise<Response> {
  return app.handle(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(withKey ? { "X-API-Key": "test-secret" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    })
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json()
}

describe("routes /message-templates (integrasi)", () => {
  beforeAll(async () => {
    await initDb()
    cfg.apiKey = "test-secret"
    cfg.gemini.apiKey = ""
    cfg.template.maxPerMinute = 10
  })

  afterAll(async () => {
    cfg.apiKey = original.apiKey
    cfg.gemini.apiKey = original.geminiApiKey
    cfg.template.maxPerMinute = original.maxPerMinute
    const sql = getDb()
    await sql`DELETE FROM message_templates WHERE created_by = 'route-test'`
    await closeDb()
  })

  it("menyediakan daftar kategori dan gaya bahasa berbahasa Indonesia", async () => {
    const res = await req("/message-templates/categories")
    const body = await json(res)

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.categories).toHaveLength(10)
    expect(body.tones).toHaveLength(4)
    expect(body.categories[0].label).toBe("Sapaan Pasien Baru")
    expect(body.categories.map((c: { value: string }) => c.value)).toContain(
      "pemberitahuan_poli_tutup"
    )
    expect(body.tones.map((t: { value: string }) => t.value)).toEqual([
      "formal",
      "ramah",
      "friendly",
      "singkat",
    ])
  })

  it("menolak request tanpa API key (401)", async () => {
    const res = await req("/message-templates", {}, false)
    const body = await json(res)

    expect(res.status).toBe(401)
    expect(body).toEqual({ success: false, error: "Unauthorized" })
  })

  it("menolak request dengan API key salah (401)", async () => {
    const res = await app.handle(
      new Request("http://localhost/message-templates", {
        headers: { "X-API-Key": "salah" },
      })
    )

    expect(res.status).toBe(401)
  })

  it("membuat template manual dengan createdBy dari header", async () => {
    const res = await req("/message-templates", {
      method: "POST",
      headers: { "X-Created-By": "route-test" },
      body: JSON.stringify({
        name: "Sapaan Pasien Baru",
        category: "sapaan_pasien_baru",
        tone: "formal",
        content: "Selamat pagi {{nama_pasien}}, selamat datang di {{nama_poli}}.",
        purpose: "Menyapa pasien baru",
      }),
    })
    const body = await json(res)

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.template.id).toBeTruthy()
    expect(body.template.category).toBe("sapaan_pasien_baru")
    expect(body.template.tone).toBe("formal")
    expect(body.template.isActive).toBe(true)
    expect(body.template.createdBy).toBe("route-test")
    expect(body.template.createdAt).toBeTruthy()
    expect(body.template.updatedAt).toBeTruthy()
  })

  it("menolak kategori tidak valid dengan pesan bahasa Indonesia (400)", async () => {
    const res = await req("/message-templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Template Uji",
        category: "ngawur",
        tone: "formal",
        content: "Isi pesan",
      }),
    })
    const body = await json(res)

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain("Kategori template tidak valid")
  })

  it("menolak body dengan tipe field salah (400, pesan Indonesia)", async () => {
    const res = await req("/message-templates", {
      method: "POST",
      body: JSON.stringify({ name: 123, category: "lainnya", tone: "formal", content: "Isi" }),
    })
    const body = await json(res)

    expect(res.status).toBe(400)
    expect(body.error).toContain("Format permintaan tidak valid")
  })

  it("mengambil detail template dan menolak id yang tidak ada", async () => {
    const createdRes = await req("/message-templates", {
      method: "POST",
      headers: { "X-Created-By": "route-test" },
      body: JSON.stringify({
        name: "Detail Template",
        category: "ucapan_terima_kasih",
        tone: "ramah",
        content: "Terima kasih {{nama_pasien}} sudah berkunjung.",
      }),
    })
    const created = await json(createdRes)

    const res = await req(`/message-templates/${created.template.id}`)
    const body = await json(res)
    expect(res.status).toBe(200)
    expect(body.template.id).toBe(created.template.id)

    const missing = await req("/message-templates/tidakada")
    const missingBody = await json(missing)
    expect(missing.status).toBe(404)
    expect(missingBody.error).toContain("tidak ditemukan")
  })

  it("memperbarui template termasuk menonaktifkan", async () => {
    const createdRes = await req("/message-templates", {
      method: "POST",
      headers: { "X-Created-By": "route-test" },
      body: JSON.stringify({
        name: "Template Update",
        category: "layanan_pelanggan",
        tone: "singkat",
        content: "Isi awal",
      }),
    })
    const created = await json(createdRes)

    const res = await req(`/message-templates/${created.template.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "Isi diperbarui", isActive: false }),
    })
    const body = await json(res)

    expect(res.status).toBe(200)
    expect(body.template.content).toBe("Isi diperbarui")
    expect(body.template.isActive).toBe(false)

    const missing = await req("/message-templates/tidakada", {
      method: "PATCH",
      body: JSON.stringify({ isActive: true }),
    })
    expect(missing.status).toBe(404)
  })

  it("list mendukung pencarian dan filter dengan total", async () => {
    await req("/message-templates", {
      method: "POST",
      headers: { "X-Created-By": "route-test" },
      body: JSON.stringify({
        name: "Survei Kepuasan Rumah Sakit",
        category: "survei_kepuasan",
        tone: "formal",
        content: "Mohon isi survei kepuasan layanan kami.",
      }),
    })

    const searched = await req("/message-templates?q=survei")
    const searchedBody = await json(searched)
    expect(searched.status).toBe(200)
    expect(searchedBody.templates.length).toBeGreaterThanOrEqual(1)
    expect(searchedBody.total).toBe(searchedBody.templates.length)
    expect(
      searchedBody.templates.every((t: { name: string }) => /survei/i.test(t.name))
    ).toBe(true)

    const filtered = await req("/message-templates?category=survei_kepuasan&tone=formal")
    const filteredBody = await json(filtered)
    expect(
      filteredBody.templates.every(
        (t: { category: string; tone: string }) =>
          t.category === "survei_kepuasan" && t.tone === "formal"
      )
    ).toBe(true)

    const paged = await req("/message-templates?limit=1")
    const pagedBody = await json(paged)
    expect(pagedBody.templates.length).toBeLessThanOrEqual(1)
    expect(pagedBody.total).toBeGreaterThanOrEqual(searchedBody.total)

    const invalidActive = await req("/message-templates?active=maybe")
    const invalidActiveBody = await json(invalidActive)
    expect(invalidActive.status).toBe(400)
    expect(invalidActiveBody.error).toContain("Parameter active tidak valid")
  })

  it("menghapus template lalu mengembalikan 404 untuk penghapusan kedua", async () => {
    const createdRes = await req("/message-templates", {
      method: "POST",
      headers: { "X-Created-By": "route-test" },
      body: JSON.stringify({
        name: "Template Hapus Route",
        category: "lainnya",
        tone: "ramah",
        content: "Isi",
      }),
    })
    const created = await json(createdRes)

    const deleted = await req(`/message-templates/${created.template.id}`, { method: "DELETE" })
    const deletedBody = await json(deleted)
    expect(deleted.status).toBe(200)
    expect(deletedBody.message).toBe("Template pesan dihapus")

    const again = await req(`/message-templates/${created.template.id}`, { method: "DELETE" })
    expect(again.status).toBe(404)
  })

  it("menduplikasi template dengan akhiran nama (Salinan)", async () => {
    const createdRes = await req("/message-templates", {
      method: "POST",
      headers: { "X-Created-By": "route-test" },
      body: JSON.stringify({
        name: "Promo Acara",
        category: "promo_dan_acara",
        tone: "friendly",
        content: "Kami punya promo menarik untuk Anda.",
      }),
    })
    const created = await json(createdRes)

    const res = await req(`/message-templates/${created.template.id}/duplicate`, {
      method: "POST",
      headers: { "X-Created-By": "route-test" },
    })
    const body = await json(res)

    expect(res.status).toBe(200)
    expect(body.template.name).toBe("Promo Acara (Salinan)")
    expect(body.template.content).toBe(created.template.content)
    expect(body.template.createdBy).toBe("route-test")
  })

  it("generate menolak tujuan pesan kosong (400)", async () => {
    const res = await req("/message-templates/generate", {
      method: "POST",
      body: JSON.stringify({
        category: "lainnya",
        tone: "singkat",
        purpose: "",
      }),
    })
    const body = await json(res)

    expect(res.status).toBe(400)
    expect(body.error).toContain("Tujuan pesan")
  })

  it("generate mengembalikan 503 bila GEMINI_API_KEY belum dikonfigurasi", async () => {
    const res = await req("/message-templates/generate", {
      method: "POST",
      body: JSON.stringify({
        category: "pengingat_kunjungan",
        tone: "formal",
        purpose: "Mengingatkan jadwal kunjungan besok",
      }),
    })
    const body = await json(res)

    expect(res.status).toBe(503)
    expect(body.error).toContain("Fitur AI belum dikonfigurasi")
  })

  it("generate mengembalikan 429 saat rate limit tercapai", async () => {
    cfg.template.maxPerMinute = 0

    const res = await req("/message-templates/generate", {
      method: "POST",
      body: JSON.stringify({
        category: "pengingat_kunjungan",
        tone: "formal",
        purpose: "Mengingatkan jadwal kunjungan besok",
      }),
    })
    const body = await json(res)

    cfg.template.maxPerMinute = original.maxPerMinute

    expect(res.status).toBe(429)
    expect(body.error).toContain("per menit tercapai")
  })

  it("generate sukses mengembalikan draf dari Gemini (fetch di-mock)", async () => {
    cfg.gemini.apiKey = "test-key-route"
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        name: "Pengingat Kunjungan Besok",
                        content:
                          "Halo {{nama_pasien}}, ini pengingat kunjungan Anda ke {{nama_poli}} pada {{tanggal_kunjungan}} pukul {{jam_kunjungan}}.",
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    )
    vi.stubGlobal("fetch", fetchMock)

    try {
      const res = await req("/message-templates/generate", {
        method: "POST",
        body: JSON.stringify({
          category: "pengingat_kunjungan",
          tone: "formal",
          purpose: "Mengingatkan pasien jadwal kunjungan besok",
        }),
      })
      const body = await json(res)

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.draft.name).toBe("Pengingat Kunjungan Besok")
      expect(body.draft.content).toContain("{{tanggal_kunjungan}}")
      expect(body.draft.category).toBe("pengingat_kunjungan")
      expect(body.draft.tone).toBe("formal")

      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).not.toContain("test-key-route")
    } finally {
      vi.unstubAllGlobals()
      cfg.gemini.apiKey = ""
    }
  })
})
