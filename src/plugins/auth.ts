import { Elysia } from "elysia"
import { config } from "../config"

export const authPlugin = new Elysia()
  .onBeforeHandle(({ request }) => {
    if (!config.apiKey) return

    const apiKey = request.headers.get("X-API-Key")
    if (apiKey !== config.apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      )
    }
  })
