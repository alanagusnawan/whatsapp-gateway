import { getRedis } from "../storage/redis"
import { logger } from "./logger"

const DEFAULT_TTL = 300 // 5 minutes

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const redis = getRedis()
      const data = await redis.get(key)
      return data ? JSON.parse(data) : null
    } catch {
      return null
    }
  },

  async set(key: string, value: any, ttl = DEFAULT_TTL): Promise<void> {
    try {
      const redis = getRedis()
      await redis.set(key, JSON.stringify(value), "EX", ttl)
    } catch (err) {
      logger.debug({ err, key }, "Cache set failed")
    }
  },

  async del(pattern: string): Promise<void> {
    try {
      const redis = getRedis()
      const keys = await redis.keys(pattern)
      if (keys.length > 0) {
        await redis.del(...keys)
      }
    } catch (err) {
      logger.debug({ err, pattern }, "Cache del failed")
    }
  },

  async delSession(sessionId: string): Promise<void> {
    await this.del(`wa:${sessionId}:*`)
  },
}
