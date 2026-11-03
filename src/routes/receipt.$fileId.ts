import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "@/lib/auth.functions";
import { driveDownload } from "@/lib/mahavtaar.server";

export const Route = createFileRoute("/receipt/$fileId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        await requireSession();
        const file = await driveDownload(params.fileId);
        return new Response(file.body, {
          headers: {
            "Content-Type": file.contentType,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
