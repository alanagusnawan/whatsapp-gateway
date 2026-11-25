import { describe, it, expect, vi } from "vitest"
import { messageQueue } from "./queue.js"
import { messageService } from "./index.js"

describe("MessageQueue", () => {
  it("enqueues message and processes with pacing", async () => {
    let sendCalls = 0
    vi.spyOn(messageService, "executeSend").mockImplementation(async (payload) => {
      sendCalls++
      return { id: `msg_${sendCalls}` }
    })

    const job1 = await messageQueue.enqueue({
      sessionId: "test-sess",
      to: "628123456789",
      text: "hello 1",
    })

    const job2 = await messageQueue.enqueue({
      sessionId: "test-sess",
      to: "628123456789",
      text: "hello 2",
    })

    expect(job1.id).toBeDefined()
    expect(job2.id).toBeDefined()

    // Wait until background queue finishes processing
    let attempts = 0
    while (attempts < 20) {
      const j1 = await messageQueue.getJob(job1.id)
      const j2 = await messageQueue.getJob(job2.id)
      if (j1?.status === "completed" && j2?.status === "completed") {
        break
      }
      await new Promise((r) => setTimeout(r, 100))
      attempts++
    }

    const res1 = await messageQueue.getJob(job1.id)
    const res2 = await messageQueue.getJob(job2.id)

    expect(res1?.status).toBe("completed")
    expect(res2?.status).toBe("completed")
    expect(sendCalls).toBe(2)
  })
})
