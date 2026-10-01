import { getDb } from "../storage/postgres.js"

const CHUNK = 500

interface MessageRow {
  session_id: string
  message_id: string
  chat_jid: string
  from_jid: string | null
  from_me: boolean
  message_type: string | null
  text: string | null
  timestamp: number
  raw: any | null
}

export const messageStore = {
  async upsertBulk(sessionId: string, messages: any[]): Promise<number> {
    if (messages.length === 0) return 0
    const sql = getDb()

    const values = messages.map((m) => {
      const msg = m.message || {}
      const text = msg.conversation
        || msg.extendedTextMessage?.text
        || msg.imageMessage?.caption
        || msg.videoMessage?.caption
        || msg.documentMessage?.caption
        || ""
      const type = msg.imageMessage ? "image"
        : msg.videoMessage ? "video"
        : msg.documentMessage ? "document"
        : msg.audioMessage ? "audio"
        : msg.stickerMessage ? "sticker"
        : msg.locationMessage ? "location"
        : "text"

      return {
        session_id: sessionId,
        message_id: m.key?.id || "",
        chat_jid: m.key?.remoteJid || "",
        from_jid: m.key?.participant || m.key?.remoteJid || "",
        from_me: !!m.key?.fromMe,
        message_type: type,
        text: text || null,
        timestamp: Number(m.messageTimestamp) || 0,
        raw: m.message ? JSON.parse(JSON.stringify(m.message, (k, v) => v instanceof Uint8Array ? { type: "Buffer", data: Array.from(v) } : v)) : null,
      }
    }).filter((v) => v.message_id)

    let inserted = 0
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK)
      await sql`INSERT INTO wa_messages ${sql(chunk, 'session_id', 'message_id', 'chat_jid', 'from_jid', 'from_me', 'message_type', 'text', 'timestamp', 'raw')}
        ON CONFLICT (session_id, message_id) DO NOTHING`
      inserted += chunk.length
    }

    return inserted
  },

  async insert(sessionId: string, msg: {
    messageId: string
    chatJid: string
    fromJid: string
    fromMe: boolean
    type: string
    text: string
    timestamp: number
    raw?: any
  }): Promise<void> {
    const sql = getDb()
    const rawJson = msg.raw ? JSON.parse(JSON.stringify(msg.raw, (k: string, v: any) => v instanceof Uint8Array ? { type: "Buffer", data: Array.from(v) } : v)) : null
    await sql`INSERT INTO wa_messages (session_id, message_id, chat_jid, from_jid, from_me, message_type, text, timestamp, raw)
      VALUES (${sessionId}, ${msg.messageId}, ${msg.chatJid}, ${msg.fromJid}, ${msg.fromMe}, ${msg.type}, ${msg.text}, ${msg.timestamp}, ${rawJson}::jsonb)
      ON CONFLICT (session_id, message_id) DO NOTHING`
  },

  async getByChat(sessionId: string, chatJid: string, limit = 50, offset = 0): Promise<MessageRow[]> {
    const sql = getDb()
    return sql<MessageRow[]>`SELECT * FROM wa_messages
      WHERE session_id = ${sessionId} AND chat_jid = ${chatJid}
      ORDER BY timestamp DESC
      LIMIT ${limit} OFFSET ${offset}`
  },

  async count(sessionId: string): Promise<number> {
    const sql = getDb()
    const [row] = await sql<{ count: number }[]>`SELECT COUNT(*) as count FROM wa_messages WHERE session_id = ${sessionId}`
    return row?.count || 0
  },

  async countByChat(sessionId: string): Promise<{ chat_jid: string; count: number }[]> {
    const sql = getDb()
    return sql<{ chat_jid: string; count: number }[]>`SELECT chat_jid, COUNT(*) as count FROM wa_messages WHERE session_id = ${sessionId} GROUP BY chat_jid`
  },
}
