import { templateStore } from "../../storage/template-store.js"
import { geminiService, sanitizeTemplateText } from "./gemini.js"
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_LIMITS,
  TEMPLATE_TONES,
  categoryChoices,
  isTemplateCategory,
  isTemplateTone,
  toneChoices,
} from "./constants.js"
import type {
  MessageTemplate,
  MessageTemplateCategory,
  MessageTemplateTone,
} from "../../schemas/index.js"

export interface CreateTemplateInput {
  name: string
  category: string
  tone: string
  content: string
  purpose?: string
  additionalInstructions?: string
  isActive?: boolean
  createdBy?: string
}

export interface UpdateTemplateInput {
  name?: string
  category?: string
  tone?: string
  content?: string
  purpose?: string
  additionalInstructions?: string
  isActive?: boolean
}

export interface TemplateListQuery {
  q?: string
  category?: string
  tone?: string
  active?: string
  limit?: string | number
  offset?: string | number
}

const NOT_FOUND = "Template pesan tidak ditemukan."

function requireName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : ""
  if (name.length < TEMPLATE_LIMITS.nameMin) {
    throw new Error(`Nama template wajib diisi minimal ${TEMPLATE_LIMITS.nameMin} karakter.`)
  }
  if (name.length > TEMPLATE_LIMITS.nameMax) {
    throw new Error(`Nama template maksimal ${TEMPLATE_LIMITS.nameMax} karakter.`)
  }
  return name
}

function requireCategory(value: unknown): MessageTemplateCategory {
  if (!isTemplateCategory(value)) {
    throw new Error(`Kategori template tidak valid. Pilihan: ${categoryChoices()}.`)
  }
  return value
}

function requireTone(value: unknown): MessageTemplateTone {
  if (!isTemplateTone(value)) {
    throw new Error(`Gaya bahasa tidak valid. Pilihan: ${toneChoices()}.`)
  }
  return value
}

function requireContent(value: unknown): string {
  const content = sanitizeTemplateText(
    typeof value === "string" ? value : "",
    TEMPLATE_LIMITS.contentMax
  )
  if (content.length < TEMPLATE_LIMITS.contentMin) {
    throw new Error("Isi template wajib diisi.")
  }
  return content
}

function optionalPurpose(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const purpose = typeof value === "string" ? value.trim() : ""
  if (purpose.length < TEMPLATE_LIMITS.purposeMin) {
    throw new Error(`Tujuan pesan minimal ${TEMPLATE_LIMITS.purposeMin} karakter.`)
  }
  if (purpose.length > TEMPLATE_LIMITS.purposeMax) {
    throw new Error(`Tujuan pesan maksimal ${TEMPLATE_LIMITS.purposeMax} karakter.`)
  }
  return purpose
}

function optionalAdditionalInstructions(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const text = typeof value === "string" ? value.trim() : ""
  if (text.length > TEMPLATE_LIMITS.additionalInstructionsMax) {
    throw new Error(`Instruksi tambahan maksimal ${TEMPLATE_LIMITS.additionalInstructionsMax} karakter.`)
  }
  return text
}

function optionalContext(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const text = typeof value === "string" ? value.trim() : ""
  if (text.length > TEMPLATE_LIMITS.contextMax) {
    throw new Error(`Konteks maksimal ${TEMPLATE_LIMITS.contextMax} karakter.`)
  }
  return text
}

function clampInt(value: string | number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || value === "") return fallback
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) {
    throw new Error("Parameter limit/offset tidak valid.")
  }
  return Math.min(Math.max(Math.floor(parsed), min), max)
}

function resolveCreatedBy(value: unknown): string {
  const createdBy = typeof value === "string" ? value.trim() : ""
  if (!createdBy) return "api"
  return createdBy.slice(0, TEMPLATE_LIMITS.createdByMax)
}

export const templateService = {
  categories: () => TEMPLATE_CATEGORIES,
  tones: () => TEMPLATE_TONES,

  async create(input: CreateTemplateInput): Promise<MessageTemplate> {
    return templateStore.create({
      name: requireName(input.name),
      category: requireCategory(input.category),
      tone: requireTone(input.tone),
      content: requireContent(input.content),
      purpose: optionalPurpose(input.purpose),
      additionalInstructions: optionalAdditionalInstructions(input.additionalInstructions),
      isActive: input.isActive ?? true,
      createdBy: resolveCreatedBy(input.createdBy),
    })
  },

  async getById(id: string): Promise<MessageTemplate> {
    const template = await templateStore.getById(id)
    if (!template) throw new Error(NOT_FOUND)
    return template
  },

  async list(query: TemplateListQuery): Promise<{ templates: MessageTemplate[]; total: number }> {
    let q: string | undefined
    if (typeof query.q === "string" && query.q.trim()) {
      q = query.q.trim().slice(0, TEMPLATE_LIMITS.queryMax)
    }

    let active: boolean | undefined
    if (query.active !== undefined && query.active !== "") {
      if (query.active === "true") active = true
      else if (query.active === "false") active = false
      else throw new Error("Parameter active tidak valid. Gunakan true atau false.")
    }

    return templateStore.list({
      q,
      category: query.category ? requireCategory(query.category) : undefined,
      tone: query.tone ? requireTone(query.tone) : undefined,
      active,
      limit: clampInt(query.limit, 1, TEMPLATE_LIMITS.listLimitMax, TEMPLATE_LIMITS.listLimitDefault),
      offset: clampInt(query.offset, 0, Number.MAX_SAFE_INTEGER, 0),
    })
  },

  async update(id: string, patch: UpdateTemplateInput): Promise<MessageTemplate> {
    const existing = await this.getById(id)

    const data: Parameters<typeof templateStore.update>[1] = {}
    if (patch.name !== undefined) data.name = requireName(patch.name)
    if (patch.category !== undefined) data.category = requireCategory(patch.category)
    if (patch.tone !== undefined) data.tone = requireTone(patch.tone)
    if (patch.content !== undefined) data.content = requireContent(patch.content)
    if (patch.purpose !== undefined) data.purpose = optionalPurpose(patch.purpose)
    if (patch.additionalInstructions !== undefined)
      data.additionalInstructions = optionalAdditionalInstructions(patch.additionalInstructions)
    if (patch.isActive !== undefined) data.isActive = patch.isActive

    if (Object.keys(data).length === 0) return existing

    const updated = await templateStore.update(id, data)
    if (!updated) throw new Error(NOT_FOUND)
    return updated
  },

  async delete(id: string): Promise<void> {
    const deleted = await templateStore.delete(id)
    if (!deleted) throw new Error(NOT_FOUND)
  },

  async duplicate(id: string, createdBy?: string): Promise<MessageTemplate> {
    const existing = await this.getById(id)
    const suffix = " (Salinan)"
    const name = existing.name.slice(0, TEMPLATE_LIMITS.nameMax - suffix.length) + suffix

    const duplicated = await templateStore.create({
      name,
      category: existing.category,
      tone: existing.tone,
      content: existing.content,
      purpose: existing.purpose,
      additionalInstructions: existing.additionalInstructions,
      isActive: existing.isActive,
      createdBy: resolveCreatedBy(createdBy),
    })
    return duplicated
  },

  async generate(input: {
    category: string
    tone: string
    purpose: string
    additionalInstructions?: string
    context?: string
  }) {
    const category = requireCategory(input.category)
    const tone = requireTone(input.tone)
    const purpose = optionalPurpose(input.purpose)
    if (!purpose) {
      throw new Error(`Tujuan pesan wajib diisi minimal ${TEMPLATE_LIMITS.purposeMin} karakter.`)
    }
    const additionalInstructions = optionalAdditionalInstructions(input.additionalInstructions)
    const context = optionalContext(input.context)

    const rateCheck = geminiService.checkGenerateRateLimit()
    if (!rateCheck.allowed) {
      throw new Error(rateCheck.reason || "Batas permintaan AI tercapai. Coba lagi beberapa saat.")
    }

    return geminiService.generateTemplateDraft({
      category,
      tone,
      purpose,
      additionalInstructions,
      context,
    })
  },
}
