import { Redis } from "ioredis"
import { config } from "../config/index.js"
import { logger } from "../utils/logger.js"

let redis: Redis | null = null

export function getRedis(): Redis {
  if (!redis) {
    throw new Error("Redis not initialized. Call initRedis() first.")
  }
  return redis
}

export function initRedis(): Redis {
  if (redis) return redis

  const { host, port, password, db } = config.redis

  redis = new Redis({
    host,
    port,
    password,
    db,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 3) {
        logger.warn("Redis max retries reached, disabling cache")
        return null
      }
      return Math.min(times * 200, 2000)
    },
  })

  redis.on("connect", () => {
    logger.info({ host, port, db }, "Redis connected")
  })

  redis.on("error", (err: Error) => {
    logger.warn({ err }, "Redis error (cache disabled)")
  })

  return redis
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit()
    redis = null
  }
}
