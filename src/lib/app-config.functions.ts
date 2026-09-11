import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Centralised page/feature visibility + notifications.
// Both live in dedicated sheet tabs so they are shared across devices.

export const FEATURES = [
  { key: "entry", label: "Payment Entry", path: "/" },
  { key: "report", label: "Reports", path: "/report" },
  { key: "loans", label: "Loan Details", path: "/loans" },
  { key: "pending", label: "Pending Receipts", path: "/pending" },
  { key: "ecs", label: "ECS / Special", path: "/ecs" },
  { key: "remarks", label: "Remarks", path: null },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type FeatureFlags = Record<string, boolean>;

export const DEFAULT_FLAGS: FeatureFlags = Object.fromEntries(
  FEATURES.map((f) => [f.key, true]),
);

export type Notification = {
  id: string;
  text: string;
  imageUrl: string;
  status: string;
  createdAt: string;
};

const SETTINGS_TAB = "AppSettings";
const NOTIF_TAB = "Notifications";

export const getAppConfig = createServerFn({ method: "GET" }).handler(async () => {
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
    await ensureSheet(NOTIF_TAB, [
      "Notification",
      "Image URL",
      "Status",
      "Created At",
      "ID",
    ]).catch(() => undefined);
  }

  const flags: FeatureFlags = { ...DEFAULT_FLAGS };
  for (const r of settingRows) {
    const key = (r[0] ?? "").trim();
    if (key !== "") flags[key] = (r[1] ?? "").trim().toUpperCase() !== "OFF";
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

  return { flags, notifications };
});

export const verifySettingsPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const expected = "Mahadev@Babaji@0003";
    const input = data.password;
    let diff = input.length === expected.length ? 0 : 1;
    for (let i = 0; i < Math.max(input.length, expected.length); i++) {
      diff |= (input.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
    }
    return { ok: diff === 0 };
  });

export const saveFeatureFlags = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ flags: z.record(z.string().max(40), z.boolean()) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sheetsUpdate, ensureSheet } = await import("./mahavtaar.server");
    await ensureSheet(SETTINGS_TAB, ["Key", "Value"]);
    const entries = Object.entries(data.flags);
    const values = entries.map(([k, v]) => [k, v ? "ON" : "OFF"]);
    // Pad so removed keys never leave stale rows behind.
    while (values.length < 40) values.push(["", ""]);
    await sheetsUpdate(`${SETTINGS_TAB}!A2:B41`, values);
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
    const { sheetsAppend, driveUpload, ensureSheet } = await import("./mahavtaar.server");
    await ensureSheet(NOTIF_TAB, [
      "Notification",
      "Image URL",
      "Status",
      "Created At",
      "ID",
    ]);
    let imageUrl = "";
    if (data.image) {
      imageUrl = await driveUpload(
        `notification-${Date.now()}-${data.image.name}`,
        data.image.mimeType,
        data.image.base64,
      );
    }
    const id = `NTF-${Date.now()}`;
    await sheetsAppend(`${NOTIF_TAB}!A:E`, [
      [data.text, imageUrl, "Active", new Date().toISOString(), id],
    ]);
    return { ok: true as const, id, imageUrl };
  });

export const removeNotification = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().trim().min(1).max(60) }).parse(d))
  .handler(async ({ data }) => {
    const { sheetsGet, sheetsUpdate } = await import("./mahavtaar.server");
    const rows = await sheetsGet(`${NOTIF_TAB}!A2:E`);
    const idx = rows.findIndex(
      (r, i) => ((r[4] ?? "").trim() || `row-${i + 2}`) === data.id,
    );
    if (idx === -1) throw new Error("Notification not found.");
    await sheetsUpdate(`${NOTIF_TAB}!C${idx + 2}`, [["Removed"]]);
    return { ok: true as const };
  });
