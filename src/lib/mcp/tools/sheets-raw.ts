import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sheetsGet, sheetsAppend, sheetsUpdate } from "../../mahavtaar.server";

export default defineTool({
  name: "sheets_read_write",
  title: "Direct Google Sheets Read and Write",
  description:
    "Directly reads, appends, or updates row data across any tab in the Google Spreadsheet (e.g. Collections, ECS_Special_Info, AppSettings, Notifications, or Monthly sheets).",
  inputSchema: {
    action: z
      .enum(["get", "append", "update"])
      .describe(
        "Operation to perform: 'get' to read rows, 'append' to add rows, 'update' to overwrite a range.",
      ),
    range: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe(
        "Google Sheet range in A1 notation (e.g. 'Collections!A1:J20', 'AppSettings!A1:B', 'ECS_Special_Info!A:L').",
      ),
    values: z
      .array(z.array(z.union([z.string(), z.number()])))
      .optional()
      .default([])
      .describe("2D matrix of row values to write when using 'append' or 'update'."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ action, range, values }) => {
    if (action === "get") {
      const rows = await sheetsGet(range);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ range, rowCount: rows.length, rows }),
          },
        ],
        structuredContent: { range, rowCount: rows.length, rows },
      };
    }

    if (action === "append") {
      if (!values || values.length === 0) {
        throw new Error("Values array cannot be empty for append operation.");
      }
      const res = await sheetsAppend(range, values);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              action,
              range,
              appendedCount: values.length,
              details: res,
            }),
          },
        ],
        structuredContent: { success: true, action, range, appendedCount: values.length },
      };
    }

    if (action === "update") {
      if (!values || values.length === 0) {
        throw new Error("Values array cannot be empty for update operation.");
      }
      const res = await sheetsUpdate(range, values);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              action,
              range,
              updatedRows: values.length,
              details: res,
            }),
          },
        ],
        structuredContent: { success: true, action, range, updatedRows: values.length },
      };
    }

    throw new Error(`Unsupported action: ${action}`);
  },
});
