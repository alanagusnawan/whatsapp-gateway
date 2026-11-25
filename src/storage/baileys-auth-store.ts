import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys"
import { getDb } from "./postgres.js"
import { logger } from "../utils/logger.js"

export async function usePostgresAuthState(sessionId: string): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
  clearAuthState: () => Promise<void>
}> {
  const sql = getDb()

  const readData = async (keyId: string): Promise<any | null> => {
    try {
      const rows = await sql<{ value: string }[]>`
        SELECT value FROM baileys_auth_states
        WHERE session_id = ${sessionId} AND key_id = ${keyId}
      `
      if (!rows.length || !rows[0].value) return null
      return JSON.parse(rows[0].value, BufferJSON.reviver)
    } catch (err) {
      logger.error({ err, sessionId, keyId }, "Failed to read auth state from postgres")
      return null
    }
  }

  const writeData = async (keyId: string, value: any): Promise<void> => {
    try {
      const serialized = JSON.stringify(value, BufferJSON.replacer)
      await sql`
        INSERT INTO baileys_auth_states (session_id, key_id, value, updated_at)
        VALUES (${sessionId}, ${keyId}, ${serialized}, NOW())
        ON CONFLICT (session_id, key_id)
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `
    } catch (err) {
      logger.error({ err, sessionId, keyId }, "Failed to write auth state to postgres")
      throw err
    }
  }

  const removeData = async (keyId: string): Promise<void> => {
    try {
      await sql`
        DELETE FROM baileys_auth_states
        WHERE session_id = ${sessionId} AND key_id = ${keyId}
      `
    } catch (err) {
      logger.error({ err, sessionId, keyId }, "Failed to delete auth state from postgres")
    }
  }

  const creds: AuthenticationCreds =
    (await readData("creds")) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {}
          if (!ids.length) return data

          const keyIds = ids.map((id) => `${type}-${id}`)

          try {
            const rows = await sql<{ key_id: string; value: string }[]>`
              SELECT key_id, value FROM baileys_auth_states
              WHERE session_id = ${sessionId} AND key_id IN ${sql(keyIds)}
            `

            const rowMap = new Map<string, string>()
            for (const r of rows) {
              rowMap.set(r.key_id, r.value)
            }

            for (const id of ids) {
              const fullKey = `${type}-${id}`
              const raw = rowMap.get(fullKey)
              if (raw) {
                let value = JSON.parse(raw, BufferJSON.reviver)
                if (type === "app-state-sync-key" && value) {
                  value = proto.Message.AppStateSyncKeyData.fromObject(value)
                }
                data[id] = value
              }
            }
          } catch (err) {
            logger.error({ err, sessionId, type }, "Failed to batch get keys from postgres")
          }

          return data
        },
        set: async (data: SignalDataSet): Promise<void> => {
          const writes: { keyId: string; value: string }[] = []
          const deletes: string[] = []

          for (const category in data) {
            for (const id in data[category as keyof SignalDataSet]) {
              const value = data[category as keyof SignalDataSet]?.[id]
              const keyId = `${category}-${id}`
              if (value) {
                writes.push({
                  keyId,
                  value: JSON.stringify(value, BufferJSON.replacer),
                })
              } else {
                deletes.push(keyId)
              }
            }
          }

          if (writes.length > 0) {
            await sql`
              INSERT INTO baileys_auth_states ${sql(
                writes.map((w) => ({
                  session_id: sessionId,
                  key_id: w.keyId,
                  value: w.value,
                  updated_at: new Date(),
                }))
              )}
              ON CONFLICT (session_id, key_id)
              DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `
          }

          if (deletes.length > 0) {
            await sql`
              DELETE FROM baileys_auth_states
              WHERE session_id = ${sessionId} AND key_id IN ${sql(deletes)}
            `
          }
        },
      },
    },
    saveCreds: async () => {
      await writeData("creds", creds)
    },
    clearAuthState: async () => {
      await sql`DELETE FROM baileys_auth_states WHERE session_id = ${sessionId}`
    },
  }
}

export async function deletePostgresAuthState(sessionId: string): Promise<void> {
  const sql = getDb()
  await sql`DELETE FROM baileys_auth_states WHERE session_id = ${sessionId}`
}

export async function hasPostgresAuthState(sessionId: string): Promise<boolean> {
  try {
    const sql = getDb()
    const rows = await sql<{ value: string }[]>`
      SELECT value FROM baileys_auth_states
      WHERE session_id = ${sessionId} AND key_id = 'creds'
    `
    if (!rows.length || !rows[0].value) return false
    const creds = JSON.parse(rows[0].value, BufferJSON.reviver)
    return !!creds?.me?.id
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to check postgres auth state")
    return false
  }
}

