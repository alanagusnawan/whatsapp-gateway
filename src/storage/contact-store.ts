import { getDb } from "../storage/postgres.js"
import type { Contact } from "../schemas/index.js"

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
      phone: c.phone || "",
      name: c.name || null,
      push_name: c.pushName || null,
      is_group: c.isGroup,
    }))

    let inserted = 0
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK)
      await sql`INSERT INTO wa_contacts ${sql(chunk, 'session_id', 'jid', 'phone', 'name', 'push_name', 'is_group')}
        ON CONFLICT (session_id, jid) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, wa_contacts.name),
          push_name = COALESCE(EXCLUDED.push_name, wa_contacts.push_name),
          phone = CASE WHEN EXCLUDED.phone <> '' THEN EXCLUDED.phone ELSE wa_contacts.phone END,
          synced_at = NOW()`
      inserted += chunk.length
    }

    return inserted
  },

  async updatePhoneByJid(sessionId: string, jid: string, phone: string): Promise<void> {
    if (!phone) return
    const sql = getDb()
    await sql`UPDATE wa_contacts SET phone = ${phone}, synced_at = NOW()
      WHERE session_id = ${sessionId} AND jid = ${jid} AND phone = ''`
  },

  async getLidJids(sessionId: string): Promise<string[]> {
    const sql = getDb()
    const rows = await sql<{ jid: string }[]>`SELECT DISTINCT jid FROM wa_contacts
      WHERE session_id = ${sessionId} AND jid LIKE '%@lid'`
    return rows.map((r) => r.jid)
  },

  // Merge baris contact LID ke jid kanonik (PN)
  async mergeJid(sessionId: string, fromJid: string, toJid: string): Promise<void> {
    if (fromJid === toJid) return
    const sql = getDb()
    const [src] = await sql<ContactRow[]>`SELECT * FROM wa_contacts WHERE session_id = ${sessionId} AND jid = ${fromJid}`
    if (!src) return
    const [dst] = await sql<ContactRow[]>`SELECT * FROM wa_contacts WHERE session_id = ${sessionId} AND jid = ${toJid}`

    if (!dst) {
      await sql`UPDATE wa_contacts SET jid = ${toJid}, synced_at = NOW()
        WHERE session_id = ${sessionId} AND jid = ${fromJid}`
      return
    }

    await sql`UPDATE wa_contacts SET
        name = ${src.name || dst.name || null},
        push_name = ${src.push_name || dst.push_name || null},
        phone = ${src.phone || dst.phone || ""},
        synced_at = NOW()
      WHERE session_id = ${sessionId} AND jid = ${toJid}`
    await sql`DELETE FROM wa_contacts WHERE session_id = ${sessionId} AND jid = ${fromJid}`
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
