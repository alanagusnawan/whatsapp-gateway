import { config } from "../config/index.js"
import { logger } from "../utils/logger.js"

interface SendRecord {
  timestamps: number[]
}

class RateLimiter {
  private records = new Map<string, SendRecord>()

  private getRecord(sessionId: string): SendRecord {
    let record = this.records.get(sessionId)
    if (!record) {
      record = { timestamps: [] }
      this.records.set(sessionId, record)
    }
    return record
  }

  private prune(record: SendRecord, windowMs: number): void {
    const cutoff = Date.now() - windowMs
    record.timestamps = record.timestamps.filter((t) => t > cutoff)
  }

  check(sessionId: string): { allowed: boolean; reason?: string } {
    const record = this.getRecord(sessionId)
    const now = Date.now()

    this.prune(record, 60_000)
    if (record.timestamps.length >= config.message.maxPerMinute) {
      logger.warn({ sessionId, count: record.timestamps.length }, "Rate limit: per minute exceeded")
      return { allowed: false, reason: `Max ${config.message.maxPerMinute} messages per minute` }
    }

    this.prune(record, 3_600_000)
    if (record.timestamps.length >= config.message.maxPerHour) {
      logger.warn({ sessionId, count: record.timestamps.length }, "Rate limit: per hour exceeded")
      return { allowed: false, reason: `Max ${config.message.maxPerHour} messages per hour` }
    }

    const last = record.timestamps[record.timestamps.length - 1]
    if (last) {
      const elapsed = now - last
      const minDelay = config.message.minDelayMs
      if (elapsed < minDelay) {
        const waitMs = minDelay - elapsed
        return { allowed: false, reason: `Wait ${waitMs}ms before sending again` }
      }
    }

    return { allowed: true }
  }

  record(sessionId: string): void {
    const record = this.getRecord(sessionId)
    record.timestamps.push(Date.now())
  }

  getNextDelay(sessionId: string): number {
    const record = this.getRecord(sessionId)
    const last = record.timestamps[record.timestamps.length - 1]
    if (!last) return 0

    const elapsed = Date.now() - last
    const minDelay = config.message.minDelayMs
    const maxDelay = config.message.maxDelayMs

    const baseDelay = Math.max(0, minDelay - elapsed)
    const jitter = Math.floor(Math.random() * (maxDelay - minDelay))
    return baseDelay + jitter
  }
}

export const rateLimiter = new RateLimiter()
