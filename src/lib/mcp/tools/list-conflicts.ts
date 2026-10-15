import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { loadCollections } from "../data";

export default defineTool({
  name: "list_conflicts",
  title: "List payment conflicts and duplicates",
  description:
    "Detects potential duplicate payment entries (same Loan ID and payment amount) with comparison details, receipt links, and validation status ('VALIDATED' vs unvalidated).",
  inputSchema: {
    unresolvedOnly: z
      .boolean()
      .default(true)
      .describe("If true, only returns groups where at least one entry is unvalidated."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ unresolvedOnly }) => {
    const rows = await loadCollections();

    // Group by loanId + amount
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.loanId || r.amount <= 0) continue;
      const key = `${r.loanId.toLowerCase()}__${r.amount}`;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }

    const conflictGroups = [];
    for (const [key, entries] of groups.entries()) {
      if (entries.length < 2) continue;
      const hasUnresolved = entries.some(
        (e) => (e.validatedStatus ?? "").toUpperCase() !== "VALIDATED",
      );
      if (unresolvedOnly && !hasUnresolved) continue;

      conflictGroups.push({
        groupKey: key,
        loanId: entries[0].loanId,
        amount: entries[0].amount,
        count: entries.length,
        isFullyValidated: !hasUnresolved,
        entries: entries.map((e) => ({
          rowNumber: e.rowNumber,
          executive: e.executive,
          paymentDate: e.date,
          entryDate: e.entryDate,
          time: e.time,
          entryType: e.entryType,
          status: e.status,
          validatedStatus: e.validatedStatus ?? "",
          receipts: e.receiptLinks,
          remark: e.remark,
        })),
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            totalConflictGroups: conflictGroups.length,
            conflictGroups,
          }),
        },
      ],
      structuredContent: {
        totalConflictGroups: conflictGroups.length,
        conflictGroups,
      },
    };
  },
});
