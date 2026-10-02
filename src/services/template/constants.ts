import type { MessageTemplateCategory, MessageTemplateTone } from "../../schemas/index.js"

export const TEMPLATE_CATEGORIES: ReadonlyArray<{
  value: MessageTemplateCategory
  label: string
}> = [
  { value: "sapaan_pasien_baru", label: "Sapaan Pasien Baru" },
  { value: "follow_up_customer", label: "Follow-up Customer/Pasien" },
  { value: "pemberitahuan_poli_tutup", label: "Pemberitahuan Poli Tutup" },
  { value: "pengingat_kunjungan", label: "Pengingat Kunjungan Besok" },
  { value: "ucapan_terima_kasih", label: "Ucapan Terima Kasih" },
  { value: "survei_kepuasan", label: "Survei Kepuasan Layanan" },
  { value: "promo_dan_acara", label: "Promo dan Acara" },
  { value: "layanan_pelanggan", label: "Layanan Pelanggan" },
  { value: "informasi_layanan_rs", label: "Informasi Layanan Rumah Sakit" },
  { value: "lainnya", label: "Lainnya" },
]

export const TEMPLATE_TONES: ReadonlyArray<{
  value: MessageTemplateTone
  label: string
  description: string
}> = [
  {
    value: "formal",
    label: "Formal",
    description: "Profesional, sopan, dan sesuai komunikasi resmi rumah sakit",
  },
  { value: "ramah", label: "Ramah", description: "Sopan, hangat, dan empatik" },
  { value: "friendly", label: "Friendly", description: "Santai, natural, dan tetap sopan" },
  { value: "singkat", label: "Singkat", description: "Langsung pada inti informasi" },
]

export const TEMPLATE_LIMITS = {
  nameMin: 3,
  nameMax: 100,
  contentMin: 1,
  contentMax: 2000,
  purposeMin: 3,
  purposeMax: 500,
  additionalInstructionsMax: 500,
  contextMax: 2000,
  queryMax: 200,
  createdByMax: 100,
  listLimitDefault: 50,
  listLimitMax: 100,
} as const

export const TEMPLATE_PLACEHOLDERS = [
  "{{nama_pasien}}",
  "{{nama_poli}}",
  "{{tanggal_kunjungan}}",
  "{{jam_kunjungan}}",
] as const

export function isTemplateCategory(value: unknown): value is MessageTemplateCategory {
  return TEMPLATE_CATEGORIES.some((c) => c.value === value)
}

export function isTemplateTone(value: unknown): value is MessageTemplateTone {
  return TEMPLATE_TONES.some((t) => t.value === value)
}

export function categoryLabel(value: MessageTemplateCategory): string {
  return TEMPLATE_CATEGORIES.find((c) => c.value === value)?.label ?? value
}

export function toneLabel(value: MessageTemplateTone): string {
  return TEMPLATE_TONES.find((t) => t.value === value)?.label ?? value
}

export function categoryChoices(): string {
  return TEMPLATE_CATEGORIES.map((c) => c.label).join(", ")
}

export function toneChoices(): string {
  return TEMPLATE_TONES.map((t) => t.label).join(", ")
}
