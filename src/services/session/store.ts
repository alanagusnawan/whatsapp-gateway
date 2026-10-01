import { getDb } from "../../storage/postgres.js"
import type { Session, EngineType, SessionStatus } from "../../schemas/index.js"

interface SessionRow {
  id: string
  name: string
  engine: EngineType
  status: SessionStatus
  phone: string | null
  created_at: string
  updated_at: string
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    name: row.name,
    engine: row.engine,
    status: row.status,
    phone: row.phone || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const sessionStore = {
  async create(session: Session): Promise<void> {
    const sql = getDb()
    await sql`
      INSERT INTO sessions (id, name, engine, status, phone, created_at, updated_at)
      VALUES (${session.id}, ${session.name}, ${session.engine}, ${session.status}, ${session.phone || null}, ${session.createdAt}, ${session.updatedAt})
    `
  },

  async getById(id: string): Promise<Session | null> {
    const sql = getDb()
    const [row] = await sql<SessionRow[]>`SELECT * FROM sessions WHERE id = ${id}`
    return row ? rowToSession(row) : null
  },

  async getAll(): Promise<Session[]> {
    const sql = getDb()
    const rows = await sql<SessionRow[]>`SELECT * FROM sessions ORDER BY created_at DESC`
    return rows.map(rowToSession)
  },

  async updateStatus(id: string, status: SessionStatus, phone?: string): Promise<void> {
    const sql = getDb()
    if (phone) {
      await sql`UPDATE sessions SET status = ${status}, phone = ${phone}, updated_at = NOW() WHERE id = ${id}`
    } else {
      await sql`UPDATE sessions SET status = ${status}, updated_at = NOW() WHERE id = ${id}`
    }
  },

  async delete(id: string): Promise<boolean> {
    const sql = getDb()
    const result = await sql`DELETE FROM sessions WHERE id = ${id}`
    return result.count > 0
  },
}
