import { defineMcp } from "@lovable.dev/mcp-js";

import loadCollectionData from "./tools/load-collection-data";
import readAllCollections from "./tools/read-all-collections";
import openReceiptImage from "./tools/open-receipt-image";
import editCollectionAmount from "./tools/edit-amount";
import writeAmansRemarks from "./tools/write-amans-remarks";
import collectionSummary from "./tools/collection-summary";
import loanPayments from "./tools/loan-payments";
import loanSummary from "./tools/loan-summary";
import shortEmiCases from "./tools/short-emi-cases";
import executiveCityReport from "./tools/executive-city-report";
import detailedReport from "./tools/detailed-report";
import listAlreadyPaid from "./tools/list-already-paid";
import highlightAlreadyPaid from "./tools/highlight-already-paid";
import pendingReceipts from "./tools/pending-receipts";
import recordPending from "./tools/record-pending";
import completePending from "./tools/complete-pending";
import uploadReceiptImage from "./tools/upload-receipt-image";
import attachReceipt from "./tools/attach-receipt";
import recordPayment from "./tools/record-payment";
import updatePayment from "./tools/update-payment";
import deletePayment from "./tools/delete-payment";
import listEcs from "./tools/list-ecs";
import recordEcs from "./tools/record-ecs";
import updateEcs from "./tools/update-ecs";
import listConflicts from "./tools/list-conflicts";
import resolveConflict from "./tools/resolve-conflict";
import resolveConflictGroup from "./tools/resolve-conflict-group";
import highlightConflicts from "./tools/highlight-conflicts";
import getSettings from "./tools/get-settings";
import updateSettings from "./tools/update-settings";
import addNotification from "./tools/add-notification";
import removeNotification from "./tools/remove-notification";
import sheetsRaw from "./tools/sheets-raw";

export default defineMcp({
  name: "daily-collection-hub",
  title: "Mahavtaar Daily Collection Hub",
  version: "0.5.0",
  instructions:
    "Comprehensive suite of read and write tools for Mahavtaar Daily Collection: load, filter, and parse collection data; full sequential EMI loan analytics and short EMI tracking; executive-city performance breakdown; date-wise & monthly reports; Already Paid case listings and sheet highlighting; pending receipt management (creation, review, completion into collections, and image upload to Drive); payment entry recording, updating, and deletion; ECS/Special entry tracking; conflict detection, sheet highlighting, and resolution; app settings & notifications; and raw Google Sheets operations.",
  tools: [
    loadCollectionData,
    readAllCollections,
    loanSummary,
    shortEmiCases,
    loanPayments,
    executiveCityReport,
    detailedReport,
    collectionSummary,
    listAlreadyPaid,
    highlightAlreadyPaid,
    openReceiptImage,
    uploadReceiptImage,
    attachReceipt,
    pendingReceipts,
    recordPending,
    completePending,
    recordPayment,
    updatePayment,
    deletePayment,
    editCollectionAmount,
    writeAmansRemarks,
    listEcs,
    recordEcs,
    updateEcs,
    listConflicts,
    resolveConflict,
    resolveConflictGroup,
    highlightConflicts,
    getSettings,
    updateSettings,
    addNotification,
    removeNotification,
    sheetsRaw,
  ],
});
