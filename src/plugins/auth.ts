import { Elysia } from "elysia"
import { config } from "../config/index.js"

export function authGuard({ request }: { request: Request }): Response | undefined {
  if (!config.apiKey) return

  // Header X-API-Key, atau query param (WebSocket/SSE dari browser tidak bisa set header)
  const url = new URL(request.url)
  const apiKey = request.headers.get("X-API-Key") || url.searchParams.get("apiKey")
  if (apiKey !== config.apiKey) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}

export const authPlugin = new Elysia().onBeforeHandle(authGuard)
