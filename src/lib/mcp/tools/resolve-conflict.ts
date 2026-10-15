import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  markConflictAsValid,
  revertConflictValidation,
  deleteCollectionRow,
} from "../../mahavtaar.functions";

export default defineTool({
  name: "resolve_conflict",
  title: "Resolve payment conflict",
  description:
    "Resolves a payment conflict row by marking it valid ('VALIDATED'), reverting its validation, or deleting the duplicate row from Google Sheets.",
  inputSchema: {
    action: z
      .enum(["mark_valid", "revert_validation", "delete_entry"])
      .describe(
        "Action to take on the conflicting row: 'mark_valid', 'revert_validation', or 'delete_entry'.",
      ),
    rowNumber: z.number().int().min(2).describe("Row number in Collections sheet to resolve."),
    note: z.string().default("").describe("Optional resolution note."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ action, rowNumber, note }) => {
    if (action === "mark_valid") {
      await markConflictAsValid({
        data: { row: rowNumber, note },
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              action,
              rowNumber,
              status: "VALIDATED",
            }),
          },
        ],
        structuredContent: { success: true, action, rowNumber, status: "VALIDATED" },
      };
    }

    if (action === "revert_validation") {
      await revertConflictValidation({
        data: { row: rowNumber },
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              action,
              rowNumber,
              status: "UNVALIDATED",
            }),
          },
        ],
        structuredContent: { success: true, action, rowNumber, status: "UNVALIDATED" },
      };
    }

    if (action === "delete_entry") {
      await deleteCollectionRow({
        data: { row: rowNumber },
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              action,
              rowNumber,
              status: "DELETED",
            }),
          },
        ],
        structuredContent: { success: true, action, rowNumber, status: "DELETED" },
      };
    }

    throw new Error(`Unsupported conflict resolution action: ${action}`);
  },
});
