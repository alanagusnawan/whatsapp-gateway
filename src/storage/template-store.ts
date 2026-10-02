import { getDb } from "../storage/postgres.js"
import type {
  MessageTemplate,
  MessageTemplateCategory,
  MessageTemplateTone,
} from "../schemas/index.js"
import { randomUUID } from "node:crypto"

interface MessageTemplateRow {
  id: string
  name: string
  category: string
  tone: string
  content: string
  purpose: string | null
  additional_instructions: string | null
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

function rowToTemplate(row: MessageTemplateRow): MessageTemplate {
  return {
    id: row.id,
    name: row.name,
    category: row.category as MessageTemplateCategory,
    tone: row.tone as MessageTemplateTone,
    content: row.content,
    purpose: row.purpose || undefined,
    additionalInstructions: row.additional_instructions || undefined,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface TemplateListFilters {
  q?: string
  category?: MessageTemplateCategory
  tone?: MessageTemplateTone
  active?: boolean
  limit: number
  offset: number
}

export interface CreateTemplateRow {
  name: string
  category: MessageTemplateCategory
  tone: MessageTemplateTone
  content: string
  purpose?: string
  additionalInstructions?: string
  isActive?: boolean
  createdBy: string
}

export interface UpdateTemplateRow {
  name?: string
  category?: MessageTemplateCategory
  tone?: MessageTemplateTone
  content?: string
  purpose?: string
  additionalInstructions?: string
  isActive?: boolean
}

export const templateStore = {
  async create(data: CreateTemplateRow): Promise<MessageTemplate> {
    const sql = getDb()
    const id = randomUUID().slice(0, 8)

    const [row] = await sql<MessageTemplateRow[]>`
      INSERT INTO message_templates (
        id, name, category, tone, content,
        purpose, additional_instructions, is_active, created_by,
        created_at, updated_at
      )
      VALUES (
        ${id}, ${data.name}, ${data.category}, ${data.tone}, ${data.content},
        ${data.purpose || null}, ${data.additionalInstructions || null},
        ${data.isActive ?? true}, ${data.createdBy}, NOW(), NOW()
      )
      RETURNING *
    `

    return rowToTemplate(row)
  },

  async getById(id: string): Promise<MessageTemplate | null> {
    const sql = getDb()
    const [row] = await sql<MessageTemplateRow[]>`
      SELECT * FROM message_templates WHERE id = ${id}
    `
    return row ? rowToTemplate(row) : null
  },

  async list(
    filters: TemplateListFilters
  ): Promise<{ templates: MessageTemplate[]; total: number }> {
    const sql = getDb()
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters.q) {
      params.push(`%${filters.q}%`)
      conditions.push(`(name ILIKE $${params.length} OR content ILIKE $${params.length})`)
    }
    if (filters.category) {
      params.push(filters.category)
      conditions.push(`category = $${params.length}`)
    }
    if (filters.tone) {
      params.push(filters.tone)
      conditions.push(`tone = $${params.length}`)
    }
    if (filters.active !== undefined) {
      params.push(filters.active)
      conditions.push(`is_active = $${params.length}`)
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const limit = Math.floor(filters.limit)
    const offset = Math.floor(filters.offset)

    const rows = (await sql.unsafe(
      `SELECT * FROM message_templates ${whereSql} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params as never[]
    )) as MessageTemplateRow[]
    const [countRow] = (await sql.unsafe(
      `SELECT COUNT(*)::text AS total FROM message_templates ${whereSql}`,
      params as never[]
    )) as { total: string }[]

    return { templates: rows.map(rowToTemplate), total: parseInt(countRow?.total || "0", 10) }
  },

  async update(id: string, data: UpdateTemplateRow): Promise<MessageTemplate | null> {
    const sql = getDb()
    const sets: string[] = []
    const params: unknown[] = []

    const assign = (column: string, value: unknown) => {
      params.push(value)
      sets.push(`${column} = $${params.length}`)
    }

    if (data.name !== undefined) assign("name", data.name)
    if (data.category !== undefined) assign("category", data.category)
    if (data.tone !== undefined) assign("tone", data.tone)
    if (data.content !== undefined) assign("content", data.content)
    if (data.purpose !== undefined) assign("purpose", data.purpose)
    if (data.additionalInstructions !== undefined)
      assign("additional_instructions", data.additionalInstructions)
    if (data.isActive !== undefined) assign("is_active", data.isActive)

    if (sets.length === 0) return this.getById(id)

    params.push(id)
    const [row] = (await sql.unsafe(
      `UPDATE message_templates SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${
        params.length
      } RETURNING *`,
      params as never[]
    )) as MessageTemplateRow[]

    return row ? rowToTemplate(row) : null
  },

  async delete(id: string): Promise<boolean> {
    const sql = getDb()
    const result = await sql`DELETE FROM message_templates WHERE id = ${id}`
    return result.count > 0
  },
}
