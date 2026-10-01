import postgres from "postgres"
import { config } from "../config/index.js"
import { logger } from "../utils/logger.js"

let sql: postgres.Sql | null = null

export function getDb(): postgres.Sql {
  if (!sql) {
    throw new Error("Database not initialized. Call initDb() first.")
  }
  return sql
}

export async function initDb(): Promise<postgres.Sql> {
  if (sql) return sql

  const { host, port, user, password, database } = config.postgres

  sql = postgres({
    host,
    port,
    user,
    password,
    database,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  await sql`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    engine TEXT NOT NULL DEFAULT 'baileys',
    status TEXT NOT NULL DEFAULT 'created',
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`

  await sql`CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events JSONB NOT NULL DEFAULT '[]'::jsonb,
    secret TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`

  await sql`CREATE TABLE IF NOT EXISTS wa_contacts (
    session_id TEXT NOT NULL,
    jid TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    name TEXT,
    push_name TEXT,
    is_group BOOLEAN NOT NULL DEFAULT false,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, jid)
  )`

  await sql`CREATE TABLE IF NOT EXISTS wa_chats (
    session_id TEXT NOT NULL,
    jid TEXT NOT NULL,
    name TEXT,
    is_group BOOLEAN NOT NULL DEFAULT false,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message_text TEXT,
    last_message_timestamp BIGINT DEFAULT 0,
    phone TEXT NOT NULL DEFAULT '',
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, jid)
  )`

  await sql`ALTER TABLE wa_chats ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`

  await sql`CREATE TABLE IF NOT EXISTS wa_messages (
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    from_jid TEXT,
    from_me BOOLEAN NOT NULL DEFAULT false,
    message_type TEXT,
    text TEXT,
    timestamp BIGINT NOT NULL DEFAULT 0,
    raw JSONB,
    PRIMARY KEY (session_id, message_id)
  )`

  await sql`CREATE INDEX IF NOT EXISTS idx_wa_messages_chat ON wa_messages (session_id, chat_jid, timestamp DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_wa_contacts_phone ON wa_contacts (session_id, phone)`

  logger.info({ host, port, database }, "PostgreSQL connected")
  return sql
}

export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end()
    sql = null
  }
}
