import Redis from "ioredis"
import { config } from "../config"
import { logger } from "../utils/logger"

let redis: Redis | null = null

export function getRedis(): Redis {
  if (!redis) {
    throw new Error("Redis not initialized. Call initRedis() first.")
  }
  return redis
}

export function initRedis(): Redis {
  if (redis) return redis

  redis = new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) {
        logger.warn("Redis max retries reached, disabling cache")
        return null
      }
      return Math.min(times * 200, 2000)
    },
  })

  redis.on("connect", () => {
    logger.info("Redis connected")
  })

  redis.on("error", (err) => {
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
