import { getDb } from "../storage/postgres"
import type { Contact } from "../types"

const CHUNK = 500

interface ContactRow {
  session_id: string
  jid: string
  phone: string
  name: string | null
  push_name: string | null
  is_group: boolean
}

export const contactStore = {
  async upsertBulk(sessionId: string, contacts: Contact[]): Promise<number> {
    if (contacts.length === 0) return 0
    const sql = getDb()

    const values = contacts.map((c) => ({
      session_id: sessionId,
      jid: c.id,
      phone: c.phone,
      name: c.name || null,
      push_name: c.pushName || null,
      is_group: c.isGroup,
    }))

    let inserted = 0
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK)
      await sql`INSERT INTO wa_contacts ${sql(chunk, 'session_id', 'jid', 'phone', 'name', 'push_name', 'is_group')}
        ON CONFLICT (session_id, jid) DO UPDATE SET
          name = EXCLUDED.name,
          push_name = EXCLUDED.push_name,
          synced_at = NOW()`
      inserted += chunk.length
    }

    return inserted
  },

  async getAll(sessionId: string): Promise<Contact[]> {
    const sql = getDb()
    const rows = await sql<ContactRow[]>`SELECT * FROM wa_contacts WHERE session_id = ${sessionId} AND is_group = false ORDER BY name, phone`
    return rows.map((r) => ({
      id: r.jid,
      name: r.name || undefined,
      pushName: r.push_name || undefined,
      phone: r.phone,
      isGroup: r.is_group,
    }))
  },

  async getGroups(sessionId: string): Promise<Contact[]> {
    const sql = getDb()
    const rows = await sql<ContactRow[]>`SELECT * FROM wa_contacts WHERE session_id = ${sessionId} AND is_group = true ORDER BY name`
    return rows.map((r) => ({
      id: r.jid,
      name: r.name || undefined,
      pushName: r.push_name || undefined,
      phone: r.phone,
      isGroup: r.is_group,
    }))
  },

  async count(sessionId: string): Promise<number> {
    const sql = getDb()
    const [row] = await sql<{ count: number }[]>`SELECT COUNT(*) as count FROM wa_contacts WHERE session_id = ${sessionId}`
    return row?.count || 0
  },
}
