try {
  process.loadEnvFile()
} catch {}

export const config = {
  port: parseInt(process.env.PORT || "3000"),
  host: process.env.HOST || "0.0.0.0",

  engine: (process.env.WA_ENGINE || "baileys") as "baileys" | "wwjs",

  apiKey: process.env.API_KEY || "",

  postgres: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database: process.env.DB_NAME || "whatsapp_gateway",
  },

  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || "0"),
  },

  storage: {
    dataDir: process.env.DATA_DIR || "./data",
  },

  message: {
    minDelayMs: parseInt(process.env.MSG_MIN_DELAY || "3000"),
    maxDelayMs: parseInt(process.env.MSG_MAX_DELAY || "5000"),
    maxPerMinute: parseInt(process.env.MSG_MAX_PER_MINUTE || "10"),
    maxPerHour: parseInt(process.env.MSG_MAX_PER_HOUR || "200"),
  },

  webhook: {
    timeout: parseInt(process.env.WEBHOOK_TIMEOUT || "5000"),
    retries: parseInt(process.env.WEBHOOK_RETRIES || "3"),
  },
} as const
