import { getDb } from "../storage/postgres"
import type { Chat } from "../types"

const CHUNK = 500

interface ChatRow {
  session_id: string
  jid: string
  name: string | null
  is_group: boolean
  unread_count: number
  last_message_text: string | null
  last_message_timestamp: number | null
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
    }))

    let inserted = 0
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK)
      await sql`INSERT INTO wa_chats ${sql(chunk, 'session_id', 'jid', 'name', 'is_group', 'unread_count', 'last_message_text', 'last_message_timestamp')}
        ON CONFLICT (session_id, jid) DO UPDATE SET
          name = EXCLUDED.name,
          unread_count = EXCLUDED.unread_count,
          last_message_text = COALESCE(EXCLUDED.last_message_text, wa_chats.last_message_text),
          last_message_timestamp = GREATEST(EXCLUDED.last_message_timestamp, wa_chats.last_message_timestamp),
          synced_at = NOW()`
      inserted += chunk.length
    }

    return inserted
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
