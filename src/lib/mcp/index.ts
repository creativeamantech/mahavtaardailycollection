import { defineMcp } from "@lovable.dev/mcp-js";

import collectionSummary from "./tools/collection-summary";
import loanPayments from "./tools/loan-payments";
import pendingReceipts from "./tools/pending-receipts";
import recordPayment from "./tools/record-payment";
import updatePayment from "./tools/update-payment";
import deletePayment from "./tools/delete-payment";
import listEcs from "./tools/list-ecs";
import recordEcs from "./tools/record-ecs";
import updateEcs from "./tools/update-ecs";
import listConflicts from "./tools/list-conflicts";
import resolveConflict from "./tools/resolve-conflict";
import getSettings from "./tools/get-settings";
import updateSettings from "./tools/update-settings";
import addNotification from "./tools/add-notification";
import removeNotification from "./tools/remove-notification";
import sheetsRaw from "./tools/sheets-raw";

export default defineMcp({
  name: "daily-collection-hub",
  title: "Mahavtaar Daily Collection Hub",
  version: "0.2.0",
  instructions:
    "Full read and write tools for Mahavtaar Daily Collection. Manage daily payment collections, ECS / Special entries, conflicts & duplicates resolution, application feature flags & settings, announcement notifications, and raw Google Sheet tabs. Open access with no authentication required.",
  tools: [
    collectionSummary,
    loanPayments,
    pendingReceipts,
    recordPayment,
    updatePayment,
    deletePayment,
    listEcs,
    recordEcs,
    updateEcs,
    listConflicts,
    resolveConflict,
    getSettings,
    updateSettings,
    addNotification,
    removeNotification,
    sheetsRaw,
  ],
});
