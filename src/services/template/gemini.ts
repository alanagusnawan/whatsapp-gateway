import { config } from "../../config/index.js"
import { logger } from "../../utils/logger.js"
import { TEMPLATE_LIMITS } from "./constants.js"
import type { GenerateTemplateInput, MessageTemplateDraft } from "../../schemas/index.js"

const SYSTEM_INSTRUCTION = `Anda adalah asisten komunikasi rumah sakit yang membuat draf template pesan chat dalam bahasa Indonesia.

Aturan wajib:
- Hasilkan pesan dalam bahasa Indonesia yang sopan, jelas, dan siap digunakan pada chat WhatsApp.
- Sesuaikan isi pesan dengan kategori dan gaya bahasa yang diminta.
- Jangan mengarang jadwal dokter, jam operasional, tanggal, nama poli, tarif, promo, atau kebijakan rumah sakit.
- Gunakan placeholder {{nama_pasien}}, {{nama_poli}}, {{tanggal_kunjungan}}, dan {{jam_kunjungan}} untuk data yang belum tersedia.
- Jangan menjanjikan layanan atau hasil yang belum dikonfirmasi.
- Jangan membuat klaim medis atau memberikan diagnosis.
- Kembalikan HANYA objek JSON dengan format: {"name": "nama template (maksimal 100 karakter)", "content": "isi pesan (maksimal 2000 karakter)"}
- Jangan sertakan teks lain di luar JSON.`

const RATE_WINDOW_MS = 60_000
const generateTimestamps: number[] = []

function checkGenerateRateLimit(): { allowed: boolean; reason?: string } {
  const now = Date.now()
  while (generateTimestamps.length > 0 && generateTimestamps[0] <= now - RATE_WINDOW_MS) {
    generateTimestamps.shift()
  }
  if (generateTimestamps.length >= config.template.maxPerMinute) {
    return {
      allowed: false,
      reason: `Batas ${config.template.maxPerMinute} permintaan AI per menit tercapai. Coba lagi beberapa saat.`,
    }
  }
  generateTimestamps.push(now)
  return { allowed: true }
}

export function sanitizeTemplateText(text: string, maxLength: number): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength)
}

function buildUserPrompt(input: GenerateTemplateInput): string {
  const lines = [`Kategori: ${input.category}`, `Gaya bahasa: ${input.tone}`, `Tujuan pesan: ${input.purpose}`]
  if (input.context) lines.push(`Konteks (tanpa data sensitif): ${input.context}`)
  if (input.additionalInstructions) lines.push(`Instruksi tambahan: ${input.additionalInstructions}`)
  lines.push("Buat satu draf template pesan dalam bahasa Indonesia.")
  return lines.join("\n")
}

export const geminiService = {
  checkGenerateRateLimit,

  async generateTemplateDraft(input: GenerateTemplateInput): Promise<MessageTemplateDraft> {
    const { apiKey, model, timeoutMs, maxOutputTokens } = config.gemini

    if (!apiKey) {
      throw new Error(
        "Fitur AI belum dikonfigurasi. Set GEMINI_API_KEY pada file .env lalu restart server."
      )
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`
    const started = Date.now()

    let response: Response
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                content: { type: "STRING" },
              },
              required: ["name", "content"],
            },
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err: any) {
      const errName = err?.name
      if (errName === "TimeoutError" || errName === "AbortError") {
        logger.warn({ model, durationMs: Date.now() - started }, "Gemini request timeout")
        throw new Error("Permintaan ke Gemini melebihi batas waktu. Coba lagi.")
      }
      logger.warn({ model, err: err?.message }, "Gemini network error")
      throw new Error("Gagal terhubung ke layanan Gemini. Periksa koneksi jaringan.")
    }

    if (!response.ok) {
      logger.warn({ model, status: response.status }, "Gemini API error")
      if (response.status === 429) {
        throw new Error("Permintaan ke Gemini ditolak karena rate limit. Coba lagi beberapa saat.")
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "Autentikasi ke Gemini gagal. Periksa nilai GEMINI_API_KEY pada file .env."
        )
      }
      if (response.status === 404) {
        throw new Error("Model Gemini tidak ditemukan. Periksa nilai GEMINI_MODEL pada file .env.")
      }
      if (response.status === 400) {
        throw new Error(
          "Permintaan ke Gemini ditolak sebagai tidak valid. Periksa konfigurasi GEMINI_MODEL."
        )
      }
      throw new Error(`Layanan Gemini mengembalikan kesalahan (HTTP ${response.status}). Coba lagi nanti.`)
    }

    let payload: any
    try {
      payload = await response.json()
    } catch {
      throw new Error("Respons Gemini bukan JSON yang valid. Coba lagi.")
    }

    const candidate = payload?.candidates?.[0]
    const text = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
          .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
          .join("")
          .trim()
      : ""

    if (!text) {
      logger.warn(
        { model, finishReason: candidate?.finishReason, blockReason: payload?.promptFeedback?.blockReason },
        "Gemini empty response"
      )
      throw new Error(
        "Gemini tidak menghasilkan konten (respons kosong atau diblokir). Coba ubah instruksi."
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error("Respons Gemini bukan format JSON yang valid. Coba lagi.")
    }

    const obj = parsed as { name?: unknown; content?: unknown } | null
    const name = sanitizeTemplateText(typeof obj?.name === "string" ? obj.name : "", TEMPLATE_LIMITS.nameMax)
    const content = sanitizeTemplateText(
      typeof obj?.content === "string" ? obj.content : "",
      TEMPLATE_LIMITS.contentMax
    )

    if (name.length < TEMPLATE_LIMITS.nameMin || content.length < TEMPLATE_LIMITS.contentMin) {
      throw new Error("Respons Gemini tidak berisi nama atau isi template yang valid. Coba lagi.")
    }

    logger.info(
      { model, category: input.category, tone: input.tone, durationMs: Date.now() - started },
      "Gemini draft generated"
    )

    return { name, category: input.category, tone: input.tone, content }
  },
}
