import { defineTool } from "@lovable.dev/mcp-js";
import { loadConfig } from "../data";

export default defineTool({
  name: "get_settings",
  title: "Get app settings and feature flags",
  description:
    "Returns the current feature toggle flags (entry, report, loans, execCities, pending, ecs, notifications, alreadyPaid, conflicts), default allocation category, and active announcement banners.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const config = await loadConfig();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(config),
        },
      ],
      structuredContent: config,
    };
  },
});
