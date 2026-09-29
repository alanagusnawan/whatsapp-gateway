import { Elysia } from "elysia"

export const corsPlugin = new Elysia().onBeforeHandle(({ request, set }) => {
  if (request.method === "OPTIONS") {
    set.status = 204
    set.headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
      "Access-Control-Max-Age": "86400",
    }
    return new Response(null, { status: 204 })
  }

  set.headers = {
    "Access-Control-Allow-Origin": "*",
  }
})
