import { getDb } from "../storage/postgres.js"
import type { Chat } from "../schemas/index.js"

const CHUNK = 500

interface ChatRow {
  session_id: string
  jid: string
  name: string | null
  is_group: boolean
  unread_count: number
  last_message_text: string | null
  last_message_timestamp: number | null
  phone: string | null
}

export const chatStore = {
  async upsertBulk(sessionId: string, chats: Chat[]): Promise<number> {
    if (chats.length === 0) return 0
    const sql = getDb()

    const values = chats.map((c) => ({
      session_id: sessionId,
      jid: c.id,
      name: c.name || null,
      is_group: c.isGroup,
      unread_count: c.unreadCount || 0,
      last_message_text: c.lastMessage?.text || null,
      last_message_timestamp: c.lastMessage?.timestamp || 0,
      phone: c.phone || "",
    }))

    let inserted = 0
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK)
      await sql`INSERT INTO wa_chats ${sql(chunk, 'session_id', 'jid', 'name', 'is_group', 'unread_count', 'last_message_text', 'last_message_timestamp', 'phone')}
        ON CONFLICT (session_id, jid) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, wa_chats.name),
          unread_count = EXCLUDED.unread_count,
          last_message_text = COALESCE(EXCLUDED.last_message_text, wa_chats.last_message_text),
          last_message_timestamp = GREATEST(EXCLUDED.last_message_timestamp, wa_chats.last_message_timestamp),
          phone = CASE WHEN EXCLUDED.phone <> '' THEN EXCLUDED.phone ELSE wa_chats.phone END,
          synced_at = NOW()`
      inserted += chunk.length
    }

    return inserted
  },

  async updatePhone(sessionId: string, jid: string, phone: string): Promise<void> {
    if (!phone) return
    const sql = getDb()
    await sql`UPDATE wa_chats SET phone = ${phone}, synced_at = NOW()
      WHERE session_id = ${sessionId} AND jid = ${jid} AND phone = ''`
  },

  async getLidJids(sessionId: string): Promise<string[]> {
    const sql = getDb()
    const rows = await sql<{ jid: string }[]>`SELECT DISTINCT jid FROM wa_chats
      WHERE session_id = ${sessionId} AND jid LIKE '%@lid'`
    return rows.map((r) => r.jid)
  },

  // Merge baris chat LID ke jid kanonik (PN) — satu akun tidak boleh terpecah
  async mergeJid(sessionId: string, fromJid: string, toJid: string): Promise<void> {
    if (fromJid === toJid) return
    const sql = getDb()
    const [src] = await sql<ChatRow[]>`SELECT * FROM wa_chats WHERE session_id = ${sessionId} AND jid = ${fromJid}`
    if (!src) return
    const [dst] = await sql<ChatRow[]>`SELECT * FROM wa_chats WHERE session_id = ${sessionId} AND jid = ${toJid}`

    if (!dst) {
      await sql`UPDATE wa_chats SET jid = ${toJid}, synced_at = NOW()
        WHERE session_id = ${sessionId} AND jid = ${fromJid}`
      return
    }

    // Kedua baris ada: gabung — pesan terbaru menang, phone/name di-coalesce
    const srcNewer = (src.last_message_timestamp || 0) >= (dst.last_message_timestamp || 0)
    const keep = srcNewer ? src : dst
    const other = srcNewer ? dst : src
    await sql`UPDATE wa_chats SET
        name = ${keep.name || other.name || null},
        phone = ${keep.phone || other.phone || ""},
        unread_count = ${Math.max(src.unread_count || 0, dst.unread_count || 0)},
        last_message_text = ${keep.last_message_text || other.last_message_text || null},
        last_message_timestamp = ${Math.max(src.last_message_timestamp || 0, dst.last_message_timestamp || 0)},
        synced_at = NOW()
      WHERE session_id = ${sessionId} AND jid = ${toJid}`
    await sql`DELETE FROM wa_chats WHERE session_id = ${sessionId} AND jid = ${fromJid}`
  },

  async updateLastMessage(sessionId: string, chatJid: string, text: string, timestamp: number): Promise<void> {
    const sql = getDb()
    await sql`INSERT INTO wa_chats (session_id, jid, last_message_text, last_message_timestamp, synced_at)
      VALUES (${sessionId}, ${chatJid}, ${text}, ${timestamp}, NOW())
      ON CONFLICT (session_id, jid) DO UPDATE SET
        last_message_text = ${text},
        last_message_timestamp = GREATEST(${timestamp}, wa_chats.last_message_timestamp),
        synced_at = NOW()`
  },

  async incrementUnread(sessionId: string, chatJid: string): Promise<void> {
    const sql = getDb()
    await sql`INSERT INTO wa_chats (session_id, jid, unread_count, synced_at)
      VALUES (${sessionId}, ${chatJid}, 1, NOW())
      ON CONFLICT (session_id, jid) DO UPDATE SET
        unread_count = wa_chats.unread_count + 1,
        synced_at = NOW()`
  },

  async resetUnread(sessionId: string, chatJid: string): Promise<void> {
    const sql = getDb()
    await sql`UPDATE wa_chats SET unread_count = 0, synced_at = NOW() WHERE session_id = ${sessionId} AND jid = ${chatJid}`
  },

  async getAll(sessionId: string): Promise<Chat[]> {
    const sql = getDb()
    const rows = await sql<ChatRow[]>`SELECT * FROM wa_chats WHERE session_id = ${sessionId} ORDER BY last_message_timestamp DESC`
    return rows.map((r) => ({
      id: r.jid,
      name: r.name || undefined,
      phone: r.phone || undefined,
      isGroup: r.is_group,
      lastMessage: r.last_message_text
        ? { text: r.last_message_text, timestamp: r.last_message_timestamp || 0 }
        : undefined,
      unreadCount: r.unread_count,
    }))
  },

  async count(sessionId: string): Promise<number> {
    const sql = getDb()
    const [row] = await sql<{ count: number }[]>`SELECT COUNT(*) as count FROM wa_chats WHERE session_id = ${sessionId}`
    return row?.count || 0
  },
}
