import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Mock } from "vitest"
import { templateService } from "./index.js"
import { templateStore } from "../../storage/template-store.js"
import { geminiService } from "./gemini.js"

vi.mock("../../storage/template-store.js", () => ({
  templateStore: {
    create: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock("./gemini.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gemini.js")>()
  return {
    ...actual,
    geminiService: {
      checkGenerateRateLimit: vi.fn(() => ({ allowed: true })),
      generateTemplateDraft: vi.fn(),
    },
  }
})

const store = templateStore as unknown as {
  create: Mock
  getById: Mock
  list: Mock
  update: Mock
  delete: Mock
}

const gemini = geminiService as unknown as {
  checkGenerateRateLimit: Mock
  generateTemplateDraft: Mock
}

const VALID_TEMPLATE = {
  name: "Sapaan Pasien Baru",
  category: "sapaan_pasien_baru",
  tone: "formal",
  content: "Selamat pagi {{nama_pasien}}, selamat datang di {{nama_poli}}.",
}

describe("templateService.create", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.create.mockImplementation(async (data: Record<string, unknown>) => ({
      id: "tpl00001",
      ...data,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }))
  })

  it("membuat template dengan nilai default isActive dan createdBy", async () => {
    const template = await templateService.create(VALID_TEMPLATE)

    expect(store.create).toHaveBeenCalledWith({
      name: "Sapaan Pasien Baru",
      category: "sapaan_pasien_baru",
      tone: "formal",
      content: "Selamat pagi {{nama_pasien}}, selamat datang di {{nama_poli}}.",
      purpose: undefined,
      additionalInstructions: undefined,
      isActive: true,
      createdBy: "api",
    })
    expect(template.id).toBe("tpl00001")
  })

  it("menghapus HTML dari isi template manual", async () => {
    await templateService.create({ ...VALID_TEMPLATE, content: "<p>Halo {{nama_pasien}}</p>" })

    expect((store.create as Mock).mock.calls[0][0].content).toBe("Halo {{nama_pasien}}")
  })

  it("menolak kategori yang tidak valid", async () => {
    await expect(
      templateService.create({ ...VALID_TEMPLATE, category: "kategori_asin" })
    ).rejects.toThrow("Kategori template tidak valid")
    expect(store.create).not.toHaveBeenCalled()
  })

  it("menolak gaya bahasa yang tidak valid", async () => {
    await expect(
      templateService.create({ ...VALID_TEMPLATE, tone: "galak" })
    ).rejects.toThrow("Gaya bahasa tidak valid")
  })

  it("menolak nama terlalu pendek", async () => {
    await expect(templateService.create({ ...VALID_TEMPLATE, name: "ab" })).rejects.toThrow(
      "Nama template wajib diisi minimal 3 karakter"
    )
  })

  it("menolak nama terlalu panjang", async () => {
    await expect(
      templateService.create({ ...VALID_TEMPLATE, name: "n".repeat(101) })
    ).rejects.toThrow("Nama template maksimal 100 karakter")
  })

  it("menolak isi yang kosong setelah sanitasi", async () => {
    await expect(
      templateService.create({ ...VALID_TEMPLATE, content: "<b></b>" })
    ).rejects.toThrow("Isi template wajib diisi")
  })

  it("menolak tujuan pesan terlalu pendek", async () => {
    await expect(
      templateService.create({ ...VALID_TEMPLATE, purpose: "x" })
    ).rejects.toThrow("Tujuan pesan minimal 3 karakter")
  })

  it("menolak instruksi tambahan terlalu panjang", async () => {
    await expect(
      templateService.create({ ...VALID_TEMPLATE, additionalInstructions: "i".repeat(501) })
    ).rejects.toThrow("Instruksi tambahan maksimal 500 karakter")
  })

  it("menggunakan createdBy dari header bila disediakan", async () => {
    await templateService.create({ ...VALID_TEMPLATE, createdBy: "  admin-1  " })

    expect((store.create as Mock).mock.calls[0][0].createdBy).toBe("admin-1")
  })
})

describe("templateService.list", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.list.mockResolvedValue({ templates: [], total: 0 })
  })

  it("menormalkan query pencarian dan membatasi limit", async () => {
    await templateService.list({ q: "  sapaan  ", limit: "999", offset: "-5" })

    expect(store.list).toHaveBeenCalledWith({
      q: "sapaan",
      category: undefined,
      tone: undefined,
      active: undefined,
      limit: 100,
      offset: 0,
    })
  })

  it("menolak parameter active yang tidak valid", async () => {
    await expect(templateService.list({ active: "yes" })).rejects.toThrow(
      "Parameter active tidak valid"
    )
  })

  it("menolak limit yang bukan angka", async () => {
    await expect(templateService.list({ limit: "abc" })).rejects.toThrow(
      "Parameter limit/offset tidak valid"
    )
  })

  it("menolak kategori filter yang tidak valid", async () => {
    await expect(templateService.list({ category: "ngawur" })).rejects.toThrow(
      "Kategori template tidak valid"
    )
  })
})

describe("templateService.update / delete / duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("melempar 404-style error ketika template tidak ditemukan", async () => {
    store.getById.mockResolvedValue(null)

    await expect(templateService.getById("tidakada")).rejects.toThrow(
      "Template pesan tidak ditemukan"
    )
    await expect(templateService.update("tidakada", { isActive: false })).rejects.toThrow(
      "Template pesan tidak ditemukan"
    )
    await expect(templateService.delete("tidakada")).rejects.toThrow(
      "Template pesan tidak ditemukan"
    )
  })

  it("update parsial hanya meneruskan field yang diubah", async () => {
    store.getById.mockResolvedValue({ id: "tpl1", isActive: true })
    store.update.mockResolvedValue({ id: "tpl1", isActive: false })

    await templateService.update("tpl1", { isActive: false })

    expect(store.update).toHaveBeenCalledWith("tpl1", { isActive: false })
  })

  it("update tanpa perubahan mengembalikan data tanpa memanggil store.update", async () => {
    const existing = { id: "tpl1", name: "Lama" }
    store.getById.mockResolvedValue(existing)
    store.update.mockResolvedValue(null)

    const result = await templateService.update("tpl1", {})

    expect(result).toBe(existing)
    expect(store.update).not.toHaveBeenCalled()
  })

  it("duplicate menambahkan akhiran nama dan membatasi panjang", async () => {
    store.create.mockResolvedValue({ id: "tpl2" })
    store.getById.mockResolvedValue({
      id: "tpl1",
      name: "n".repeat(100),
      category: "lainnya",
      tone: "singkat",
      content: "Isi template",
      isActive: false,
    })

    await templateService.duplicate("tpl1", "admin-1")

    const arg = (store.create as Mock).mock.calls[0][0]
    expect(arg.name.length).toBeLessThanOrEqual(100)
    expect(arg.name.endsWith(" (Salinan)")).toBe(true)
    expect(arg.createdBy).toBe("admin-1")
    expect(arg.isActive).toBe(false)
  })
})

describe("templateService.generate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gemini.checkGenerateRateLimit.mockReturnValue({ allowed: true })
    gemini.generateTemplateDraft.mockResolvedValue({
      name: "Draf",
      category: "promo_dan_acara",
      tone: "ramah",
      content: "Pesan promo",
    })
  })

  it("meneruskan input yang tervalidasi ke Gemini", async () => {
    const draft = await templateService.generate({
      category: "promo_dan_acara",
      tone: "ramah",
      purpose: "Mengumumkan promo pemeriksaan kesehatan",
      context: "Promo berlaku bulan depan",
    })

    expect(gemini.generateTemplateDraft).toHaveBeenCalledWith({
      category: "promo_dan_acara",
      tone: "ramah",
      purpose: "Mengumumkan promo pemeriksaan kesehatan",
      additionalInstructions: undefined,
      context: "Promo berlaku bulan depan",
    })
    expect(draft.name).toBe("Draf")
  })

  it("menolak kategori tidak valid sebelum memanggil Gemini", async () => {
    await expect(
      templateService.generate({ category: "ngawur" as never, tone: "formal", purpose: "Sapaan pasien" })
    ).rejects.toThrow("Kategori template tidak valid")
    expect(gemini.generateTemplateDraft).not.toHaveBeenCalled()
  })

  it("menolak tujuan pesan yang kosong", async () => {
    await expect(
      templateService.generate({
        category: "lainnya",
        tone: "singkat",
        purpose: "",
      })
    ).rejects.toThrow("Tujuan pesan wajib diisi")
  })

  it("meneruskan error rate limit dari Gemini service", async () => {
    gemini.checkGenerateRateLimit.mockReturnValue({
      allowed: false,
      reason: "Batas 10 permintaan AI per menit tercapai. Coba lagi beberapa saat.",
    })

    await expect(
      templateService.generate({
        category: "lainnya",
        tone: "singkat",
        purpose: "Sapaan pembuka",
      })
    ).rejects.toThrow("per menit tercapai")
    expect(gemini.generateTemplateDraft).not.toHaveBeenCalled()
  })
})
