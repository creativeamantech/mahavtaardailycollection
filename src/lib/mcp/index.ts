import { defineMcp } from "@lovable.dev/mcp-js";

import loadCollectionData from "./tools/load-collection-data";
import readAllCollections from "./tools/read-all-collections";
import openReceiptImage from "./tools/open-receipt-image";
import editCollectionAmount from "./tools/edit-amount";
import writeAmansRemarks from "./tools/write-amans-remarks";
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
  version: "0.4.0",
  instructions:
    "Comprehensive read and write tools for Mahavtaar Daily Collection: load and parse complete collection data structured for the application, open and resolve receipt images directly in Google Drive, edit collection payment amounts, write or update Aman's Remarks (Column S), manage ECS entries, resolve conflicts, and direct Google Sheets access. Open access with no login required.",
  tools: [
    loadCollectionData,
    readAllCollections,
    openReceiptImage,
    editCollectionAmount,
    writeAmansRemarks,
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
