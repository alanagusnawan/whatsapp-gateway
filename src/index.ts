import { Elysia } from "elysia"
import { config } from "./config"
import { initDb, closeDb } from "./storage/postgres"
import { ensureDataDir } from "./storage/file"
import { initRedis } from "./storage/redis"
import { sessionManager } from "./services/session"
import { eventBus } from "./events/emitter"
import { dispatchWebhooks } from "./events/webhook-dispatcher"
import { sessionRoutes } from "./routes/session"
import { messageRoutes } from "./routes/message"
import { contactRoutes } from "./routes/contacts"
import { chatRoutes } from "./routes/chats"
import { groupRoutes } from "./routes/groups"
import { privacyRoutes } from "./routes/privacy"
import { broadcastRoutes } from "./routes/broadcast"
import { webhookRoutes } from "./routes/webhook"
import { eventsRoutes } from "./routes/events"
import { authPlugin } from "./plugins/auth"
import { errorPlugin } from "./plugins/error"
import { cors as corsPlugin } from "./plugins/cors"
import { logger } from "./utils/logger"

ensureDataDir(config.storage.dataDir)

await initDb()

try {
  initRedis()
} catch {
  logger.warn("Redis unavailable, running without cache")
}

sessionManager.on("event", (event) => {
  eventBus.broadcast(event)
  dispatchWebhooks(event).catch((err) => {
    logger.error({ err }, "Webhook dispatch error")
  })
})

const app = new Elysia()
  .use(
    corsPlugin({
      origin: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-API-Key", "Authorization", "Accept"],
      exposeHeaders: ["Content-Length", "Content-Type"],
      credentials: false,
      maxAge: 86400,
    }),
  )
  .use(errorPlugin)
  .use(authPlugin)
  .use(sessionRoutes)
  .use(messageRoutes)
  .use(contactRoutes)
  .use(chatRoutes)
  .use(groupRoutes)
  .use(privacyRoutes)
  .use(broadcastRoutes)
  .use(webhookRoutes)
  .use(eventsRoutes)
  .get("/", () => ({
    name: "WhatsApp Gateway",
    version: "1.0.0",
    status: "running",
  }))

Bun.serve({
  port: config.port,
  async fetch(req) {
    const start = Date.now()
    const method = req.method
    const path = new URL(req.url).pathname

    const res = await app.handle(req)

    const duration = Date.now() - start
    const status = res.status || 200
    logger.info({ method, path, status, duration: `${duration}ms` }, "request")

    return res
  },
})

logger.info({ port: config.port }, "WhatsApp Gateway running")

const shutdown = async () => {
  logger.info("Shutting down...")
  await closeDb()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
