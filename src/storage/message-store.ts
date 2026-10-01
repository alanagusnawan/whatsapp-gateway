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
  phone?: string | null
}

function phoneFromJid(jid: string | null | undefined): string {
  if (!jid) return ""
  const user = jid.split("@")[0]?.split(":")[0] || ""
  return /^[0-9]{8,15}$/.test(user) && !jid.endsWith("@lid") && !jid.endsWith("@g.us") ? user : ""
}

export const messageStore = {
  async upsertBulk(sessionId: string, messages: any[], resolveJid?: (jid: string, altJid?: string) => string): Promise<number> {
    if (messages.length === 0) return 0
    const sql = getDb()
    const canon = (jid: string, alt?: string) => (resolveJid ? resolveJid(jid, alt) : jid)

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

      const rawChatJid = m.key?.remoteJid || ""
      const rawFromJid = m.key?.participant || m.key?.remoteJid || ""
      return {
        session_id: sessionId,
        message_id: m.key?.id || "",
        chat_jid: canon(rawChatJid, m.key?.remoteJidAlt),
        from_jid: canon(rawFromJid, m.key?.participantAlt || m.key?.remoteJidAlt),
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
    const rows = await sql<MessageRow[]>`SELECT m.*,
        COALESCE(c.phone, '') AS chat_phone,
        COALESCE(s.phone, '') AS sender_phone
      FROM wa_messages m
      LEFT JOIN wa_chats c ON c.session_id = m.session_id AND c.jid = m.chat_jid
      LEFT JOIN wa_contacts s ON s.session_id = m.session_id AND s.jid = m.from_jid
      WHERE m.session_id = ${sessionId} AND m.chat_jid = ${chatJid}
      ORDER BY m.timestamp DESC
      LIMIT ${limit} OFFSET ${offset}`
    return rows.map((r: any) => ({
      session_id: r.session_id,
      message_id: r.message_id,
      chat_jid: r.chat_jid,
      from_jid: r.from_jid,
      from_me: r.from_me,
      message_type: r.message_type,
      text: r.text,
      timestamp: r.timestamp,
      raw: r.raw,
      phone: r.sender_phone || r.chat_phone || phoneFromJid(r.from_jid) || phoneFromJid(r.chat_jid),
    }))
  },

  async count(sessionId: string): Promise<number> {
    const sql = getDb()
    const [row] = await sql<{ count: number }[]>`SELECT COUNT(*) as count FROM wa_messages WHERE session_id = ${sessionId}`
    return row?.count || 0
  },

  // Pindahkan pesan dari jid lama (LID) ke jid kanonik (PN)
  async mergeJid(sessionId: string, fromJid: string, toJid: string): Promise<void> {
    if (fromJid === toJid) return
    const sql = getDb()
    await sql`UPDATE wa_messages SET chat_jid = ${toJid}
      WHERE session_id = ${sessionId} AND chat_jid = ${fromJid}`
    await sql`UPDATE wa_messages SET from_jid = ${toJid}
      WHERE session_id = ${sessionId} AND from_jid = ${fromJid}`
  },

  async countByChat(sessionId: string): Promise<{ chat_jid: string; count: number }[]> {
    const sql = getDb()
    return sql<{ chat_jid: string; count: number }[]>`SELECT chat_jid, COUNT(*) as count FROM wa_messages WHERE session_id = ${sessionId} GROUP BY chat_jid`
  },
}
