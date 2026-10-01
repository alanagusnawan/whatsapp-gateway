import { Elysia } from "elysia"
import { node } from "@elysiajs/node"
import { config } from "./config/index.js"
import { initDb, closeDb } from "./storage/postgres.js"
import { ensureDataDir } from "./storage/file.js"
import { initRedis, closeRedis } from "./storage/redis.js"
import { sessionManager } from "./services/session/index.js"
import { eventBus } from "./events/emitter.js"
import { dispatchWebhooks } from "./events/webhook-dispatcher.js"
import { sessionRoutes } from "./routes/session.js"
import { messageRoutes } from "./routes/message.js"
import { contactRoutes } from "./routes/contacts.js"
import { chatRoutes } from "./routes/chats.js"
import { groupRoutes } from "./routes/groups.js"
import { privacyRoutes } from "./routes/privacy.js"
import { broadcastRoutes } from "./routes/broadcast.js"
import { webhookRoutes } from "./routes/webhook.js"
import { eventsRoutes } from "./routes/events.js"
import { authPlugin } from "./plugins/auth.js"
import { errorPlugin } from "./plugins/error.js"
import { cors as corsPlugin } from "./plugins/cors.js"
import { logger } from "./utils/logger.js"

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

const app = new Elysia({ adapter: node() })
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
  .onAfterHandle(({ request, set }) => {
    const start = Number(request.headers.get("x-request-start") || Date.now())
    const path = new URL(request.url).pathname
    const duration = Date.now() - start
    logger.info(
      { method: request.method, path, status: set.status || 200, duration: `${duration}ms` },
      "request",
    )
  })
  .listen({ hostname: config.host, port: config.port })

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  "WhatsApp Gateway running",
)

const shutdown = async () => {
  logger.info("Shutting down...")
  app.stop()
  await closeDb()
  await closeRedis()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
