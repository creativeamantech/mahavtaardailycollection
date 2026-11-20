import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "@/lib/auth.functions";
import { readCollections } from "@/lib/mahavtaar.functions";
import { driveDownload } from "@/lib/mahavtaar.server";

function receiptIsRecorded(fileId: string, links: string[]) {
  return links.some((link) => {
    if (link === `/receipt/${fileId}`) return true;

    try {
      const url = new URL(link);
      if (url.hostname !== "drive.google.com") return false;
      const pathId = url.pathname.match(/\/d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/)?.[1];
      const queryId = url.searchParams.get("id");
      return pathId === fileId || queryId === fileId;
    } catch {
      return false;
    }
  });
}

export const Route = createFileRoute("/receipt/$fileId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        await requireSession();
        const collections = await readCollections();
        const isRecordedReceipt = collections.some((entry) =>
          receiptIsRecorded(params.fileId, entry.receiptLinks ?? []),
        );
        if (!isRecordedReceipt) {
          return new Response("Receipt not found.", {
            status: 404,
            headers: {
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }

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
