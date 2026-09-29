import { Elysia } from "elysia";
import { eventBus } from "../events/emitter";
import { sessionManager } from "../services/session";

export const eventsRoutes = new Elysia({ prefix: "/events" })
  .get("/", () => {
    const stream = new ReadableStream({
      start(controller) {
        eventBus.addSSEClient(controller);

        controller.enqueue(
          new TextEncoder().encode('data: {"type":"connected"}\n\n'),
        );
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  })
  .get("/log", ({ query }) => {
    const events = sessionManager.eventLog;
    const limit = parseInt((query as any).limit || "50");
    const offset = parseInt((query as any).offset || "0");

    return {
      success: true,
      events: events.slice(offset, offset + limit),
      total: events.length,
    };
  });
