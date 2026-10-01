import type { WhatsAppEngine, EngineFactory } from "./types.js"
import type { EngineType } from "../schemas/index.js"
import { BaileysEngine } from "./baileys/index.js"
import { WwjsEngine } from "./wwjs/index.js"
import { logger } from "../utils/logger.js"

const engines: EngineFactory[] = [
  {
    create: (sessionId, dataDir) => new BaileysEngine(sessionId, dataDir),
  },
  {
    create: (sessionId, dataDir) => new WwjsEngine(sessionId, dataDir),
  },
]

export function createEngine(
  type: EngineType,
  sessionId: string,
  dataDir: string
): WhatsAppEngine {
  const factory =
    type === "baileys" ? engines[0] : type === "wwjs" ? engines[1] : null

  if (!factory) {
    throw new Error(`Unknown engine type: ${type}`)
  }

  logger.info({ sessionId, engine: type }, "Creating WhatsApp engine")
  return factory.create(sessionId, dataDir)
}

export type { WhatsAppEngine, EngineFactory } from "./types.js"
