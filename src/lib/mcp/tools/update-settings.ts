import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { saveFeatureFlags, saveDefaultCategory } from "../../app-config.functions";

export default defineTool({
  name: "update_settings",
  title: "Update app settings and feature flags",
  description:
    "Updates application feature visibility toggles (flags) or the default allocation category in the AppSettings sheet tab.",
  inputSchema: {
    password: z
      .string()
      .max(200)
      .describe("App settings password (required to change settings)."),
    flags: z
      .record(z.string(), z.boolean())
      .optional()
      .describe(
        "Feature flags to update, e.g. { entry: true, report: true, loans: true, execCities: true, pending: true, ecs: true, notifications: true, alreadyPaid: true, conflicts: true, remarks: true }",
      ),
    defaultCategory: z
      .string()
      .trim()
      .max(80)
      .optional()
      .describe(
        "Default allocation category (e.g. 'Standard', 'Priority', or empty string for all).",
      ),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ password, flags, defaultCategory }) => {
    let updatedFlags = false;
    let updatedCategory = false;

    if (flags && Object.keys(flags).length > 0) {
      await saveFeatureFlags({
        data: { password, flags },
      });
      updatedFlags = true;
    }

    if (defaultCategory !== undefined) {
      await saveDefaultCategory({
        data: { password, category: defaultCategory },
      });
      updatedCategory = true;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            updatedFlags,
            updatedCategory,
            flags,
            defaultCategory,
          }),
        },
      ],
      structuredContent: {
        success: true,
        updatedFlags,
        updatedCategory,
        flags,
        defaultCategory,
      },
    };
  },
});
