import { auth, defineMcp } from "@lovable.dev/mcp-js";

import loadCollectionData from "./tools/load-collection-data";
import readAllCollections from "./tools/read-all-collections";
import openReceiptImage from "./tools/open-receipt-image";
import scanReceiptOcr from "./tools/scan-receipt-ocr";
import collectionSummary from "./tools/collection-summary";
import loanPayments from "./tools/loan-payments";
import loanSummary from "./tools/loan-summary";
import shortEmiCases from "./tools/short-emi-cases";
import executiveCityReport from "./tools/executive-city-report";
import detailedReport from "./tools/detailed-report";
import listAlreadyPaid from "./tools/list-already-paid";
import pendingReceipts from "./tools/pending-receipts";
import listEcs from "./tools/list-ecs";
import listConflicts from "./tools/list-conflicts";
import getSettings from "./tools/get-settings";

export default defineMcp({
  name: "daily-collection-hub",
  title: "Mahavtaar Daily Collection Hub",
  version: "0.5.0",
  limits: {
    maxRequestBodySize: 1024 * 1024,
    maxToolInputElements: 10_000,
  },
  auth: auth.oauth.issuer({
    issuer: "https://ydgexnboxazquiiqcrup.supabase.co/auth/v1",
    acceptedAudiences: "authenticated",
    resource: "https://mahavtaardailycollection.lovable.app/mcp",
  }),
  instructions:
    "Read-only tools for authenticated Mahavtaar Daily Collection users: collection summaries, loan payments and EMI analytics, executive-city reports, Already Paid listings, pending receipt listings, ECS listings, conflict listings, settings metadata, and authenticated receipt preview links. All mutation and raw Sheets operations are intentionally unavailable through MCP.",
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
    openReceiptImage,
    scanReceiptOcr,
    pendingReceipts,
    listEcs,
    listConflicts,
    getSettings,
  ],
});
