import { addTelemetrySubscriber, getTelemetryStore } from "@/lib/telemetryStore";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 1. Send immediate initial snapshot
      try {
        const snapshot = {
          type: "snapshot",
          devices: Object.values(getTelemetryStore()),
          timestamp: Date.now()
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
      } catch (e) {}

      // 2. Subscribe to real-time updates
      const unsubscribe = addTelemetrySubscriber((data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (e) {
          unsubscribe();
        }
      });

      // 3. Keepalive heartbeat ping every 10s to keep HTTP connection warm
      const keepaliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch (e) {
          clearInterval(keepaliveInterval);
          unsubscribe();
        }
      }, 10000);

      // Clean up when client disconnects
      request.signal.addEventListener("abort", () => {
        clearInterval(keepaliveInterval);
        unsubscribe();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive"
    }
  });
}
