import { createFileRoute } from "@tanstack/react-router";
import { checkConnectorHealth } from "@/lib/mahavtaar.server";

export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const connectors = await checkConnectorHealth();
          return Response.json({ status: "ok", connectors, timestamp: new Date().toISOString() });
        } catch (error) {
          console.error(
            "Health check failed:",
            error instanceof Error ? error.message : "unknown error",
          );
          return Response.json({ status: "error" }, { status: 503 });
        }
      },
    },
  },
});
