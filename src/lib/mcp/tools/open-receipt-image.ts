import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections, normId } from "../data";

function extractDriveId(url: string): string | null {
  if (!url) return null;
  // Match /file/d/{id}
  const matchFileD = /\/file\/d\/([a-zA-Z0-9_-]+)/i.exec(url);
  if (matchFileD) return matchFileD[1];

  // Match id={id}
  const matchIdParam = /[?&]id=([a-zA-Z0-9_-]+)/i.exec(url);
  if (matchIdParam) return matchIdParam[1];

  // Match bare drive ID (alphanumeric with underscores/hyphens, length 25-45)
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(url.trim())) {
    return url.trim();
  }

  return null;
}

function buildDriveLinks(rawUrl: string) {
  const fileId = extractDriveId(rawUrl);
  if (!fileId) {
    return {
      rawUrl,
      fileId: null,
      driveViewUrl: rawUrl,
      previewUrl: rawUrl,
      directDownloadUrl: rawUrl,
    };
  }

  return {
    rawUrl,
    fileId,
    driveViewUrl: `https://drive.google.com/file/d/${fileId}/view`,
    driveFolderUrl: "https://drive.google.com/drive/folders/1iBlXqe09aG5kA_hHf3WtFILnA1RibCf7",
    previewUrl: `https://lh3.googleusercontent.com/d/${fileId}`,
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`,
    directDownloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
  };
}

export default defineTool({
  name: "open_receipt_image",
  title: "Open receipt images directly in Google Drive",
  description:
    "Resolves and provides direct Google Drive view, preview, and download links for collection receipt images. Can look up receipts by Loan ID, Google Sheet row number, or direct Drive URL/File ID.",
  inputSchema: {
    receiptUrl: z.string().optional().describe("Google Drive file URL or File ID."),
    loanId: z.string().optional().describe("Loan ID to find all attached receipts for."),
    rowNumber: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Collections sheet row number to find receipts for."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ receiptUrl, loanId, rowNumber }) => {
    // If a direct URL was given
    if (receiptUrl) {
      const links = buildDriveLinks(receiptUrl);
      return {
        content: [{ type: "text", text: JSON.stringify(links) }],
        structuredContent: links,
      };
    }

    // If loanId or rowNumber was given, search collections
    const collections = await loadCollections();
    let matches = collections;

    if (rowNumber !== undefined) {
      matches = matches.filter((r) => r.row === rowNumber);
    }

    if (loanId !== undefined) {
      const targetId = normId(loanId).toLowerCase();
      matches = matches.filter((r) => r.loanId.toLowerCase() === targetId);
    }

    const receipts = [];
    for (const item of matches) {
      for (const link of item.receiptLinks) {
        receipts.push({
          rowNumber: item.row,
          loanId: item.loanId,
          executive: item.executive,
          paymentDate: item.date,
          amount: item.amount,
          ...buildDriveLinks(link),
        });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            foundReceiptsCount: receipts.length,
            receipts,
          }),
        },
      ],
      structuredContent: {
        foundReceiptsCount: receipts.length,
        receipts,
      },
    };
  },
});
