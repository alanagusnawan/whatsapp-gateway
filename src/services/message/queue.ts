import { randomUUID } from "node:crypto"
import { getRedis } from "../../storage/redis.js"
import { config } from "../../config/index.js"
import { rateLimiter } from "../../utils/rate-limiter.js"
import { messageService } from "./index.js"
import type { SendMessagePayload } from "../../schemas/index.js"
import { logger } from "../../utils/logger.js"

export type QueueJobStatus = "pending" | "processing" | "completed" | "failed"

export interface MessageJob {
  id: string
  payload: SendMessagePayload
  status: QueueJobStatus
  messageId?: string
  error?: string
  createdAt: number
  processedAt?: number
}

class MessageQueue {
  private memoryQueues = new Map<string, MessageJob[]>()
  private jobStore = new Map<string, MessageJob>()
  private processingSessions = new Set<string>()

  private isRedisAvailable(): boolean {
    try {
      const redis = getRedis()
      return redis.status === "ready" || redis.status === "connect"
    } catch {
      return false
    }
  }

  async enqueue(payload: SendMessagePayload): Promise<MessageJob> {
    const job: MessageJob = {
      id: randomUUID(),
      payload,
      status: "pending",
      createdAt: Date.now(),
    }

    if (this.isRedisAvailable()) {
      try {
        const redis = getRedis()
        await redis.set(`msg_job:${job.id}`, JSON.stringify(job), "EX", 86400)
        await redis.rpush(`msg_queue:${payload.sessionId}`, job.id)
      } catch (err) {
        logger.warn({ err, jobId: job.id }, "Failed to enqueue to Redis, fallback to memory")
        this.enqueueMemory(job)
      }
    } else {
      this.enqueueMemory(job)
    }

    // Trigger queue loop for this session
    this.processQueue(payload.sessionId).catch((err) => {
      logger.error({ err, sessionId: payload.sessionId }, "Queue processing loop error")
    })

    return job
  }

  private enqueueMemory(job: MessageJob): void {
    const sessionId = job.payload.sessionId
    this.jobStore.set(job.id, job)
    let list = this.memoryQueues.get(sessionId)
    if (!list) {
      list = []
      this.memoryQueues.set(sessionId, list)
    }
    list.push(job)
  }

  async getJob(jobId: string): Promise<MessageJob | null> {
    if (this.isRedisAvailable()) {
      try {
        const redis = getRedis()
        const raw = await redis.get(`msg_job:${jobId}`)
        if (raw) return JSON.parse(raw) as MessageJob
      } catch {}
    }
    return this.jobStore.get(jobId) || null
  }

  private async updateJob(job: MessageJob): Promise<void> {
    if (this.isRedisAvailable()) {
      try {
        const redis = getRedis()
        await redis.set(`msg_job:${job.id}`, JSON.stringify(job), "EX", 86400)
      } catch {}
    }
    this.jobStore.set(job.id, job)
  }

  private async popNextJob(sessionId: string): Promise<MessageJob | null> {
    if (this.isRedisAvailable()) {
      try {
        const redis = getRedis()
        const jobId = await redis.lpop(`msg_queue:${sessionId}`)
        if (jobId) {
          const raw = await redis.get(`msg_job:${jobId}`)
          if (raw) return JSON.parse(raw) as MessageJob
        }
      } catch (err) {
        logger.warn({ err, sessionId }, "Failed to pop job from Redis, fallback to memory")
      }
    }

    const list = this.memoryQueues.get(sessionId)
    if (list && list.length > 0) {
      return list.shift() || null
    }
    return null
  }

  private async processQueue(sessionId: string): Promise<void> {
    if (this.processingSessions.has(sessionId)) {
      return
    }

    this.processingSessions.add(sessionId)

    try {
      while (true) {
        const job = await this.popNextJob(sessionId)
        if (!job) break

        job.status = "processing"
        await this.updateJob(job)

        // Wait pacing / rate limit delay
        let delay = rateLimiter.getNextDelay(sessionId)
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay))
        }

        try {
          const result = await messageService.executeSend(job.payload)
          job.status = "completed"
          job.messageId = result.id
          job.processedAt = Date.now()
          await this.updateJob(job)
          logger.info({ sessionId, jobId: job.id, messageId: result.id }, "Queued message sent successfully")
        } catch (err: any) {
          job.status = "failed"
          job.error = err.message || "Unknown error"
          job.processedAt = Date.now()
          await this.updateJob(job)
          logger.error({ sessionId, jobId: job.id, err: err.message }, "Failed to send queued message")
        }
      }
    } finally {
      this.processingSessions.delete(sessionId)
    }
  }
}

export const messageQueue = new MessageQueue()
