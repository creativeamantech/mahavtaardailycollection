import { requireSession } from "./auth.functions";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Centralised page/feature visibility + notifications.
// Both live in dedicated sheet tabs so they are shared across devices.

export const FEATURES = [
  { key: "entry", label: "Payment Entry", path: "/" },
  { key: "report", label: "Reports", path: "/report" },
  { key: "loans", label: "Loan Details", path: "/loans" },
  { key: "adminLoanAudit", label: "Productivity Desk", path: "/admin-loan-audit" },
  { key: "execCities", label: "Executive Cities", path: "/executive-cities" },
  { key: "pending", label: "Pending Receipts", path: "/pending" },
  { key: "ecs", label: "ECS / Special", path: "/ecs" },
  { key: "notifications", label: "Notifications", path: "/notifications" },
  { key: "alreadyPaid", label: "Already Paid", path: "/already-paid" },
  { key: "conflicts", label: "Conflicts", path: "/conflicts" },
  { key: "remarks", label: "Remarks", path: null },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type FeatureFlags = Record<string, boolean>;

export const DEFAULT_FLAGS: FeatureFlags = Object.fromEntries(FEATURES.map((f) => [f.key, true]));

export type Notification = {
  id: string;
  text: string;
  imageUrl: string;
  status: string;
  createdAt: string;
};

const SETTINGS_TAB = "AppSettings";
const NOTIF_TAB = "Notifications";
// AppSettings key holding the default allocation category ("" = All Categories).
export const DEFAULT_CATEGORY_KEY = "defaultAllocationCategory";
export const HOLD_CASES_LOCK_KEY = "holdCasesLocked";

export const getAppConfig = createServerFn({ method: "GET" }).handler(async () => {
  await requireSession();
  const { sheetsGet, ensureSheet } = await import("./mahavtaar.server");

  let settingRows: string[][] = [];
  try {
    settingRows = await sheetsGet(`${SETTINGS_TAB}!A2:B`);
  } catch {
    await ensureSheet(SETTINGS_TAB, ["Key", "Value"]).catch(() => undefined);
  }

  let notifRows: string[][] = [];
  try {
    notifRows = await sheetsGet(`${NOTIF_TAB}!A2:E`);
  } catch {
    await ensureSheet(NOTIF_TAB, ["Notification", "Image URL", "Status", "Created At", "ID"]).catch(
      () => undefined,
    );
  }

  const flags: FeatureFlags = { ...DEFAULT_FLAGS };
  let defaultCategory = "";
  let holdCasesLocked = false;
  for (const r of settingRows) {
    const key = (r[0] ?? "").trim();
    if (key === "") continue;
    if (key === HOLD_CASES_LOCK_KEY) {
      holdCasesLocked = (r[1] ?? "").trim().toUpperCase() === "ON";
      continue;
    }
    if (key === DEFAULT_CATEGORY_KEY) {
      defaultCategory = (r[1] ?? "").trim();
      continue;
    }
    flags[key] = (r[1] ?? "").trim().toUpperCase() !== "OFF";
  }

  const notifications: Notification[] = notifRows
    .map((r, i) => ({
      id: (r[4] ?? "").trim() || `row-${i + 2}`,
      text: (r[0] ?? "").trim(),
      imageUrl: (r[1] ?? "").trim(),
      status: (r[2] ?? "").trim() || "Active",
      createdAt: (r[3] ?? "").trim(),
    }))
    .filter((n) => n.text !== "" || n.imageUrl !== "");

  return { flags, notifications, defaultCategory, holdCasesLocked };
});

export const saveFeatureFlags = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ flags: z.record(z.string().max(40), z.boolean()) }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const { sheetsGet, sheetsUpdateStrict, ensureSheetStrict } = await import("./mahavtaar.server");
    await ensureSheetStrict(SETTINGS_TAB, ["Key", "Value"]);
    // Preserve the default-category row so flag saves never wipe it.
    let defaultCategory = "";
    let holdCasesLocked = false;
    try {
      const rows = await sheetsGet(`${SETTINGS_TAB}!A2:B`);
      defaultCategory =
        rows.find((r) => (r[0] ?? "").trim() === DEFAULT_CATEGORY_KEY)?.[1]?.trim() ?? "";
      holdCasesLocked =
        (rows.find((r) => (r[0] ?? "").trim() === HOLD_CASES_LOCK_KEY)?.[1] ?? "")
          .trim()
          .toUpperCase() === "ON";
    } catch {
      /* keep defaults */
    }
    const entries = Object.entries(data.flags);
    const values = entries.map(([k, v]) => [k, v ? "ON" : "OFF"]);
    values.push([DEFAULT_CATEGORY_KEY, defaultCategory]);
    values.push([HOLD_CASES_LOCK_KEY, holdCasesLocked ? "ON" : "OFF"]);
    // Pad so removed keys never leave stale rows behind.
    while (values.length < 40) values.push(["", ""]);
    await sheetsUpdateStrict(`${SETTINGS_TAB}!A2:B41`, values);
    return { ok: true as const };
  });

export const saveHoldCasesLock = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ locked: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const { sheetsGet, sheetsUpdateStrict, ensureSheetStrict } = await import("./mahavtaar.server");
    await ensureSheetStrict(SETTINGS_TAB, ["Key", "Value"]);
    const rows = await sheetsGet(`${SETTINGS_TAB}!A2:B`);
    const idx = rows.findIndex((r) => (r[0] ?? "").trim() === HOLD_CASES_LOCK_KEY);
    const row = idx >= 0 ? idx + 2 : Math.max(2, rows.length + 2);
    await sheetsUpdateStrict(`${SETTINGS_TAB}!A${row}:B${row}`, [
      [HOLD_CASES_LOCK_KEY, data.locked ? "ON" : "OFF"],
    ]);
    return { ok: true as const, locked: data.locked };
  });

export const saveDefaultCategory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ category: z.string().trim().max(80) }).parse(d))
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const { sheetsGet, sheetsUpdateStrict, ensureSheetStrict } = await import("./mahavtaar.server");
    await ensureSheetStrict(SETTINGS_TAB, ["Key", "Value"]);
    let rows: string[][] = [];
    try {
      rows = await sheetsGet(`${SETTINGS_TAB}!A2:B`);
    } catch {
      /* empty tab */
    }
    const idx = rows.findIndex((r) => (r[0] ?? "").trim() === DEFAULT_CATEGORY_KEY);
    if (idx >= 0) {
      await sheetsUpdateStrict(`${SETTINGS_TAB}!B${idx + 2}`, [[data.category]]);
    } else {
      const row = rows.length + 2;
      await sheetsUpdateStrict(`${SETTINGS_TAB}!A${row}:B${row}`, [
        [DEFAULT_CATEGORY_KEY, data.category],
      ]);
    }
    return { ok: true as const };
  });

export const addNotification = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        text: z.string().trim().min(1).max(500),
        image: z
          .object({
            name: z.string().trim().min(1).max(120),
            mimeType: z.string().trim().min(1).max(80),
            base64: z.string().min(1).max(9_000_000),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const { sheetsAppendStrict, driveUpload, ensureSheetStrict } =
      await import("./mahavtaar.server");
    await ensureSheetStrict(NOTIF_TAB, ["Notification", "Image URL", "Status", "Created At", "ID"]);
    let imageUrl = "";
    if (data.image) {
      imageUrl = await driveUpload(
        `notification-${Date.now()}-${data.image.name}`,
        data.image.mimeType,
        data.image.base64,
      );
    }
    const id = `NTF-${Date.now()}`;
    await sheetsAppendStrict(`${NOTIF_TAB}!A:E`, [
      [data.text, imageUrl, "Active", new Date().toISOString(), id],
    ]);
    return { ok: true as const, id, imageUrl };
  });

export const removeNotification = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().trim().min(1).max(60) }).parse(d))
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const { sheetsGet, sheetsUpdateStrict } = await import("./mahavtaar.server");
    const rows = await sheetsGet(`${NOTIF_TAB}!A2:E`);
    const idx = rows.findIndex((r, i) => ((r[4] ?? "").trim() || `row-${i + 2}`) === data.id);
    if (idx === -1) throw new Error("Notification not found.");
    await sheetsUpdateStrict(`${NOTIF_TAB}!C${idx + 2}`, [["Removed"]]);
    return { ok: true as const };
  });


const NOTIFICATION_READS_TAB = "Notification_Reads";

export type NotificationRead = {
  notificationId: string;
  executive: string;
  seenAt: string;
};

export const getNotificationReadState = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();
  const { sheetsGetFresh, ensureSheetStrict } = await import("./mahavtaar.server");
  await ensureSheetStrict(NOTIFICATION_READS_TAB, ["Notification ID", "Executive", "Seen At"]);
  const rows = await sheetsGetFresh(`${NOTIFICATION_READS_TAB}!A2:C`);
  const allReads: NotificationRead[] = rows
    .map((row) => ({
      notificationId: (row[0] ?? "").trim(),
      executive: (row[1] ?? "").trim(),
      seenAt: (row[2] ?? "").trim(),
    }))
    .filter((row) => row.notificationId !== "" && row.executive !== "");

  // Executives can only read their own receipt records. Admins receive the
  // full read ledger for the executive-wise overview.
  const reads =
    session.role === "Admin"
      ? allReads
      : allReads.filter((row) => row.executive.toLowerCase() === session.name.toLowerCase());

  const executives =
    session.role === "Admin"
      ? [...new Set(
          (process.env["LOGIN_CREDENTIALS"] ?? "")
            .split(/[;\r\n]+/)
            .map((entry) => entry.trim().split("_"))
            .filter((parts) => parts.length === 3 && parts[1]?.trim().toLowerCase() === "executive")
            .map((parts) => parts[0]?.trim() ?? "")
            .filter(Boolean),
        )]
      : [];

  return { currentUser: session.name, role: session.role, reads, executives };
});

export const markNotificationSeen = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ notificationId: z.string().trim().min(1).max(100) }).parse(data),
  )
  .handler(async ({ data }) => {
    const session = await requireSession();
    const { sheetsGetFresh, sheetsAppendStrict, ensureSheetStrict } =
      await import("./mahavtaar.server");
    await ensureSheetStrict(NOTIF_TAB, ["Notification", "Image URL", "Status", "Created At", "ID"]);
    const notificationRows = await sheetsGetFresh(`${NOTIF_TAB}!A2:E`);
    const existsAndActive = notificationRows.some(
      (row, index) =>
        ((row[4] ?? "").trim() || `row-${index + 2}`) === data.notificationId &&
        (row[2] ?? "").trim().toLowerCase() !== "removed",
    );
    if (!existsAndActive) throw new Error("Active notification not found.");

    await ensureSheetStrict(NOTIFICATION_READS_TAB, ["Notification ID", "Executive", "Seen At"]);
    const rows = await sheetsGetFresh(`${NOTIFICATION_READS_TAB}!A2:C`);
    const alreadySeen = rows.some(
      (row) =>
        (row[0] ?? "").trim() === data.notificationId &&
        (row[1] ?? "").trim().toLowerCase() === session.name.toLowerCase(),
    );
    if (alreadySeen) return { ok: true as const, alreadySeen: true as const };

    await sheetsAppendStrict(`${NOTIFICATION_READS_TAB}!A:C`, [
      [data.notificationId, session.name, new Date().toISOString()],
    ]);
    return { ok: true as const, alreadySeen: false as const };
  });
