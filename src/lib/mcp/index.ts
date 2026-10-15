import { defineMcp } from "@lovable.dev/mcp-js";
import collectionSummary from "./tools/collection-summary";
import loanPayments from "./tools/loan-payments";
import pendingReceipts from "./tools/pending-receipts";

export default defineMcp({
  name: "daily-collection-hub",
  title: "Daily Collection Hub",
  version: "0.1.0",
  instructions:
    "Read-only tools for Mahavtaar Daily Collection: executive collection totals by date range, payments for a Loan ID, and pending receipts. Already Paid cases never count toward totals.",
  tools: [collectionSummary, loanPayments, pendingReceipts],
});
