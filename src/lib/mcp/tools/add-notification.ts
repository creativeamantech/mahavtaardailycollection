import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { sheetsAppend, ensureSheet } from "../../mahavtaar.server";

export default defineTool({
  name: "add_notification",
  title: "Add announcement notification",
  description:
    "Publishes a new announcement notification banner into Google Sheets (Notifications tab).",
  inputSchema: {
    text: z.string().trim().min(1).max(500).describe("Notification message text."),
    imageUrl: z
      .string()
      .trim()
      .max(1000)
      .default("")
      .describe("Optional public image URL to display."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ text, imageUrl }) => {
    const NOTIF_TAB = "Notifications";
    await ensureSheet(NOTIF_TAB, ["Notification", "Image URL", "Status", "Created At", "ID"]);

    const id = `NTF-${Date.now()}`;
    const now = new Date().toISOString();

    await sheetsAppend(`${NOTIF_TAB}!A:E`, [[text, imageUrl, "Active", now, id]]);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            id,
            text,
            imageUrl,
            status: "Active",
            createdAt: now,
          }),
        },
      ],
      structuredContent: {
        success: true,
        id,
        text,
        imageUrl,
        status: "Active",
        createdAt: now,
      },
    };
  },
});
