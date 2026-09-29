import { webhookStore } from "../storage/webhook-store"
import type { GatewayEvent, WebhookEvent } from "../types"
import { logger } from "../utils/logger"
import { config } from "../config"
import { createHmac } from "node:crypto"

export async function dispatchWebhooks(event: GatewayEvent): Promise<void> {
  const webhooks = await webhookStore.getActiveForEvent(
    event.type as WebhookEvent
  )

  if (webhooks.length === 0) return

  const body = JSON.stringify({
    type: event.type,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    data: event.data,
  })

  const results = await Promise.allSettled(
    webhooks.map((wh) =>
      fetch(wh.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(wh.secret
            ? {
                "X-Webhook-Signature": createHmac("sha256", wh.secret)
                  .update(body)
                  .digest("hex"),
              }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(config.webhook.timeout),
      })
    )
  )

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === "rejected") {
      logger.error(
        { webhookId: webhooks[i].id, url: webhooks[i].url, error: result.reason },
        "Webhook delivery failed"
      )
    } else if (!result.value.ok) {
      logger.warn(
        {
          webhookId: webhooks[i].id,
          url: webhooks[i].url,
          status: result.value.status,
        },
        "Webhook returned non-OK"
      )
    }
  }
}
