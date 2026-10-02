import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { config } from "../../config/index.js"
import { geminiService, sanitizeTemplateText } from "./gemini.js"

const cfg = config as unknown as {
  gemini: { apiKey: string; model: string; timeoutMs: number; maxOutputTokens: number }
  template: { maxPerMinute: number }
}

const original = {
  gemini: { ...cfg.gemini },
  maxPerMinute: cfg.template.maxPerMinute,
}

function geminiJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function draftPayload(name: string, content: string) {
  return {
    candidates: [
      { content: { parts: [{ text: JSON.stringify({ name, content }) }] } },
    ],
  }
}

const VALID_INPUT = {
  category: "sapaan_pasien_baru" as const,
  tone: "formal" as const,
  purpose: "Menyapa pasien baru saat pertama kali chat",
}

describe("geminiService.generateTemplateDraft", () => {
  beforeEach(() => {
    cfg.gemini.apiKey = "test-api-key"
    cfg.template.maxPerMinute = 10
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cfg.gemini.apiKey = original.gemini.apiKey
    cfg.gemini.model = original.gemini.model
    cfg.template.maxPerMinute = original.maxPerMinute
  })

  it("berhasil menghasilkan draf dari respons Gemini yang valid", async () => {
    const fetchMock = vi.fn(async () =>
      geminiJsonResponse(
        draftPayload("Sapaan Pasien Baru", "Selamat pagi {{nama_pasien}}, selamat datang di {{nama_poli}}.")
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    const draft = await geminiService.generateTemplateDraft(VALID_INPUT)

    expect(draft.name).toBe("Sapaan Pasien Baru")
    expect(draft.content).toContain("{{nama_pasien}}")
    expect(draft.category).toBe("sapaan_pasien_baru")
    expect(draft.tone).toBe("formal")

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain("generativelanguage.googleapis.com")
    expect(url).not.toContain("test-api-key")
    expect(url).toContain(cfg.gemini.model)
    const headers = init.headers as Record<string, string>
    expect(headers["x-goog-api-key"]).toBe("test-api-key")
    const body = JSON.parse(String(init.body))
    expect(body.systemInstruction.parts[0].text).toContain("bahasa Indonesia")
    expect(body.systemInstruction.parts[0].text).toContain("Jangan mengarang jadwal dokter")
    expect(body.generationConfig.responseMimeType).toBe("application/json")
  })

  it("menolak ketika GEMINI_API_KEY belum dikonfigurasi", async () => {
    cfg.gemini.apiKey = ""
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "Fitur AI belum dikonfigurasi"
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("melempar error ketika API mengembalikan 429 (rate limit)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiJsonResponse({}, 429)))

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow("rate limit")
  })

  it("melempar error ketika API key ditolak (401/403)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiJsonResponse({}, 401)))

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "Autentikasi ke Gemini gagal"
    )
  })

  it("melempar error ketika model tidak ditemukan (404)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiJsonResponse({}, 404)))

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "Model Gemini tidak ditemukan"
    )
  })

  it("melempar error ketika permintaan ditolak (400)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiJsonResponse({}, 400)))

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "Permintaan ke Gemini ditolak sebagai tidak valid"
    )
  })

  it("melempar error ketika request timeout", async () => {
    const timeoutError = Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" })
    vi.stubGlobal("fetch", vi.fn(async () => { throw timeoutError }))

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "melebihi batas waktu"
    )
  })

  it("melempar error ketika jaringan gagal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed") }))

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "Gagal terhubung ke layanan Gemini"
    )
  })

  it("melempar error ketika candidates kosong", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiJsonResponse({ candidates: [] })))

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "tidak menghasilkan konten"
    )
  })

  it("melempar error ketika konten diblokir oleh filter keselamatan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiJsonResponse({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] })
      )
    )

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "respons kosong atau diblokir"
    )
  })

  it("melempar error ketika body respons bukan JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bukan-json", { status: 200 })))

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "bukan JSON yang valid"
    )
  })

  it("melempar error ketika isi teks Gemini bukan JSON terstruktur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiJsonResponse({
          candidates: [{ content: { parts: [{ text: "Maaf, saya tidak bisa membantu." }] } }],
        })
      )
    )

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "bukan format JSON yang valid"
    )
  })

  it("melempar error ketika draf JSON tidak berisi nama/isi yang valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => geminiJsonResponse(draftPayload("", "   ")))
    )

    await expect(geminiService.generateTemplateDraft(VALID_INPUT)).rejects.toThrow(
      "tidak berisi nama atau isi template"
    )
  })

  it("mensterilkan HTML dan membatasi panjang hasil", async () => {
    const longContent = "Halo {{nama_pasien}}. ".repeat(500)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => geminiJsonResponse(draftPayload("<b>Sapaan</b>", `<p>${longContent}</p>`)))
    )

    const draft = await geminiService.generateTemplateDraft(VALID_INPUT)

    expect(draft.name).toBe("Sapaan")
    expect(draft.content).not.toContain("<")
    expect(draft.content.length).toBeLessThanOrEqual(2000)
  })

  it("menerapkan rate limit generate per menit", () => {
    cfg.template.maxPerMinute = 2

    expect(geminiService.checkGenerateRateLimit().allowed).toBe(true)
    expect(geminiService.checkGenerateRateLimit().allowed).toBe(true)
    const third = geminiService.checkGenerateRateLimit()
    expect(third.allowed).toBe(false)
    expect(third.reason).toContain("per menit tercapai")
  })
})

describe("sanitizeTemplateText", () => {
  it("menghapus tag HTML dan karakter kontrol", () => {
    expect(sanitizeTemplateText("<p>Halo\u0000 {{nama_pasien}}</p>", 100)).toBe(
      "Halo {{nama_pasien}}"
    )
  })

  it("merapikan newlines berlebih dan memotong sesuai batas", () => {
    const result = sanitizeTemplateText("a\n\n\n\n\nb", 4)
    expect(result).toBe("a\n\nb")
  })
})
