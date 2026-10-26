// Bank Portal Sheets Integration
// Bridges the section-aware data fetching utility in mahavtaar.server.ts
// to exclusively point to the Bank Portal Google Spreadsheet ("bank_portal").

import {
  PORTAL_TABS,
  PORTAL_TAB_HEADERS,
  DAILY_COLLECTION_SPREADSHEET_ID,
  extractSpreadsheetId,
  getBankPortalSpreadsheetId,
  getBankPortalSpreadsheetUrl,
  getBankPortalSpreadsheetConfig,
  setBankPortalSpreadsheetId,
  persistBankPortalConfig,
} from "./bank-portal-config.server";
import {
  sheetsGet,
  sheetsAppend,
  sheetsUpdate,
  sheetsBatchUpdate,
  ensureSheet,
  invalidateSheetsCache,
} from "./mahavtaar.server";

export {
  PORTAL_TABS,
  PORTAL_TAB_HEADERS,
  DAILY_COLLECTION_SPREADSHEET_ID,
  extractSpreadsheetId,
  getBankPortalSpreadsheetId,
  getBankPortalSpreadsheetUrl,
  getBankPortalSpreadsheetConfig,
  setBankPortalSpreadsheetId,
};

const GATEWAY = "https://connector-gateway.lovable.dev";

function hasCredentials(connectorKey: string): boolean {
  return Boolean(process.env["LOVABLE_API_KEY"] && process.env[connectorKey]);
}

function headers(connectorKey: string) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connKey = process.env[connectorKey];
  if (!lovableKey || !connKey) {
    throw new Error(`Missing credentials (${connectorKey}).`);
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
  };
}

// Section-aware wrappers specifically pointing to "bank_portal" section
export const portalSheetsGet = (range: string) => sheetsGet(range, "bank_portal");

export const portalSheetsAppend = (range: string, values: (string | number)[][]) =>
  sheetsAppend(range, values, "bank_portal");

export const portalSheetsUpdate = (range: string, values: (string | number)[][]) =>
  sheetsUpdate(range, values, "bank_portal");

export const portalSheetsBatchUpdate = (requests: unknown[]) =>
  sheetsBatchUpdate(requests, "bank_portal");

export const portalEnsureSheet = (title: string, header?: string[]) =>
  ensureSheet(title, header, "bank_portal");

export const invalidatePortalSheetsCache = () => invalidateSheetsCache("bank_portal");

// Create and connect a real Google Spreadsheet. Never persist a fabricated ID.
export async function createDedicatedBankPortalSpreadsheet(
  title: string = "Mahavtaar Bank Portal Usage & Accountability",
  adminActor: string = "Aman",
): Promise<{ ok: boolean; spreadsheetId: string; spreadsheetUrl: string; message: string }> {
  if (hasCredentials("GOOGLE_SHEETS_API_KEY")) {
    try {
      const res = await fetch(`${GATEWAY}/google_sheets/v4/spreadsheets`, {
        method: "POST",
        headers: {
          ...headers("GOOGLE_SHEETS_API_KEY"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            title,
          },
          sheets: [
            { properties: { title: PORTAL_TABS.SESSIONS } },
            { properties: { title: PORTAL_TABS.SCHEDULES } },
            { properties: { title: PORTAL_TABS.COMPLAINTS } },
            { properties: { title: PORTAL_TABS.WARNINGS } },
            { properties: { title: PORTAL_TABS.BANS } },
            { properties: { title: PORTAL_TABS.AUDIT } },
          ],
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { spreadsheetId: string; spreadsheetUrl?: string };
        const newId = data.spreadsheetId;
        const newUrl =
          data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${newId}/edit`;

        // Save as current bank portal config
        persistBankPortalConfig({
          spreadsheetId: newId,
          spreadsheetTitle: title,
          updatedAt: new Date().toISOString(),
          updatedBy: adminActor,
          isCustom: true,
        });

        // Invalidate cache for new sheet
        invalidateSheetsCache("bank_portal");

        // Initialize header rows on newly created sheets
        for (const [tabName, header] of Object.entries(PORTAL_TAB_HEADERS)) {
          await portalSheetsUpdate(`${tabName}!A1:${String.fromCharCode(64 + header.length)}1`, [
            header,
          ]).catch(() => {});
        }

        return {
          ok: true,
          spreadsheetId: newId,
          spreadsheetUrl: newUrl,
          message: `Dedicated Bank Portal Google Spreadsheet created successfully: ${newId}`,
        };
      }
    } catch (err) {
      console.warn("Automatic spreadsheet creation via API returned:", err);
    }
  }

  throw new Error(
    "Could not create the Bank Portal spreadsheet. Verify Lovable and Google Sheets API credentials, then retry.",
  );
}

// Ensure the Bank Portal is connected to a real spreadsheet before any portal
// reads/writes. A missing configured spreadsheet is recreated and reconnected.
let ensureSpreadsheetPromise: Promise<void> | null = null;

export async function ensureDedicatedBankPortalSpreadsheet(): Promise<void> {
  if (ensureSpreadsheetPromise) return ensureSpreadsheetPromise;

  ensureSpreadsheetPromise = (async () => {
    if (!hasCredentials("GOOGLE_SHEETS_API_KEY")) {
      throw new Error(
        "Cannot verify or create the Bank Portal spreadsheet: Google Sheets API credentials are missing.",
      );
    }

    const config = getBankPortalSpreadsheetConfig();
    const placeholderIds = [
      "1-BankPortal-Mahavtaar-Usage-Accountability-Dedicated",
      "1BankPortal_Dedicated",
    ];
    const isPlaceholder =
      !config.isCustom || placeholderIds.some((placeholder) => config.spreadsheetId.startsWith(placeholder));

    if (isPlaceholder) {
      await createDedicatedBankPortalSpreadsheet();
      return;
    }

    const response = await fetch(
      `${GATEWAY}/google_sheets/v4/spreadsheets/${config.spreadsheetId}`,
      { headers: headers("GOOGLE_SHEETS_API_KEY") },
    );

    if (response.ok) return;

    if (response.status === 404) {
      await createDedicatedBankPortalSpreadsheet(
        "Mahavtaar Bank Portal Usage & Accountability",
        "System Auto-Recovery",
      );
      return;
    }

    const details = await response.text().catch(() => "");
    throw new Error(
      `Could not verify the configured Bank Portal spreadsheet (${response.status}). ${details}`,
    );
  })();

  try {
    await ensureSpreadsheetPromise;
  } catch (error) {
    ensureSpreadsheetPromise = null;
    throw error;
  }
}
