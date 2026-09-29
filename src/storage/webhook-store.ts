import { getDb } from "../storage/postgres"
import type { WebhookConfig, WebhookEvent } from "../types"
import { randomUUID } from "node:crypto"

interface WebhookRow {
  id: string
  url: string
  events: WebhookEvent[]
  secret: string | null
  active: boolean
  created_at: string
}

function rowToWebhook(row: WebhookRow): WebhookConfig {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    secret: row.secret || undefined,
    active: row.active,
    createdAt: row.created_at,
  }
}

export const webhookStore = {
  async create(
    url: string,
    events: WebhookEvent[],
    secret?: string
  ): Promise<WebhookConfig> {
    const sql = getDb()
    const id = randomUUID().slice(0, 8)

    const [row] = await sql<WebhookRow[]>`
      INSERT INTO webhooks (id, url, events, secret, active, created_at)
      VALUES (${id}, ${url}, ${JSON.stringify(events)}::jsonb, ${secret || null}, true, NOW())
      RETURNING *
    `

    return rowToWebhook(row)
  },

  async getById(id: string): Promise<WebhookConfig | null> {
    const sql = getDb()
    const [row] = await sql<WebhookRow[]>`SELECT * FROM webhooks WHERE id = ${id}`
    return row ? rowToWebhook(row) : null
  },

  async getAll(): Promise<WebhookConfig[]> {
    const sql = getDb()
    const rows = await sql<WebhookRow[]>`SELECT * FROM webhooks ORDER BY created_at DESC`
    return rows.map(rowToWebhook)
  },

  async getActiveForEvent(eventType: WebhookEvent): Promise<WebhookConfig[]> {
    const sql = getDb()
    const rows = await sql<WebhookRow[]>`
      SELECT * FROM webhooks
      WHERE active = true AND events @> ${`["${eventType}"]`}::jsonb
    `
    return rows.map(rowToWebhook)
  },

  async update(
    id: string,
    data: { url?: string; events?: WebhookEvent[]; active?: boolean }
  ): Promise<WebhookConfig | null> {
    const existing = await this.getById(id)
    if (!existing) return null

    const sql = getDb()
    const url = data.url ?? existing.url
    const events = data.events ?? existing.events
    const active = data.active ?? existing.active

    const [row] = await sql<WebhookRow[]>`
      UPDATE webhooks SET url = ${url}, events = ${JSON.stringify(events)}::jsonb, active = ${active}
      WHERE id = ${id}
      RETURNING *
    `

    return row ? rowToWebhook(row) : null
  },

  async delete(id: string): Promise<boolean> {
    const sql = getDb()
    const result = await sql`DELETE FROM webhooks WHERE id = ${id}`
    return result.count > 0
  },
}
