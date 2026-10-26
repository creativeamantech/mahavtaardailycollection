import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { markConflictRows } from "../../mahavtaar.functions";
import { loadCollections } from "../data";

export default defineTool({
  name: "highlight_conflicts",
  title: "Highlight payment conflicts in Google Sheet",
  description:
    "Highlights duplicate/conflicting collection rows in Google Sheets with a red background so they are clearly visible in the source spreadsheet.",
  inputSchema: {
    rows: z
      .array(z.number().int().min(2))
      .optional()
      .describe(
        "Optional array of row numbers to mark in red. If omitted or empty, all conflicting unvalidated rows are automatically detected and highlighted.",
      ),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ rows }) => {
    let targetRows = rows ?? [];

    if (targetRows.length === 0) {
      const collections = await loadCollections();
      targetRows = collections.filter((r) => r.isConflict && !r.isValidated).map((r) => r.row);
    }

    if (targetRows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              highlightedCount: 0,
              message: "No unvalidated conflict rows to highlight.",
            }),
          },
        ],
        structuredContent: { success: true, highlightedCount: 0 },
      };
    }

    // Limit to max 50 per batch as constrained by schema
    const unique = [...new Set(targetRows)];
    const chunks: number[][] = [];
    for (let i = 0; i < unique.length; i += 50) {
      chunks.push(unique.slice(i, i + 50));
    }

    for (const chunk of chunks) {
      await markConflictRows({
        data: { rows: chunk },
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            highlightedCount: unique.length,
            rows: unique,
          }),
        },
      ],
      structuredContent: {
        success: true,
        highlightedCount: unique.length,
        rows: unique,
      },
    };
  },
});
