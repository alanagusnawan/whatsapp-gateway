import { existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { logger } from "../utils/logger.js"

export function ensureDataDir(dataDir: string): void {
  const abs = resolve(dataDir)
  if (!existsSync(abs)) {
    mkdirSync(abs, { recursive: true })
    logger.info({ dataDir: abs }, "Data directory created")
  }
}

export function getSessionDir(dataDir: string, sessionId: string): string {
  return resolve(dataDir, sessionId)
}
