import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { EXECUTIVES, type Executive, nowTime, todayISO } from "./executives";

export const CASHIER_LINK_TAB = "Cashier Link Activity";

export const CASHIER_LINK_HEADERS = [
  "Activity ID",
  "Executive",
  "Action",
  "Date",
  "Time",
  "Duration Seconds",
  "Duration Display",
  "Created At",
];

export type CashierLinkAction = "ON" | "OFF";

export type CashierLinkActivity = {
  id: string;
  executive: Executive | string;
  action: CashierLinkAction;
  date: string;
  time: string;
  durationSeconds: number;
  durationDisplay: string;
  createdAt: string;
  rowNumber: number;
};

export type ExecutiveLinkStatus = {
  executive: string;
  isOnline: boolean;
  lastAction: CashierLinkAction | null;
  lastDate: string | null;
  lastTime: string | null;
  onCreatedAt: string | null;
  lastDurationDisplay: string | null;
};

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }
  if (m > 0) {
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  return `${s}s`;
}

export async function readCashierLinkActivities(): Promise<{
  activities: CashierLinkActivity[];
  executiveStatuses: Record<string, ExecutiveLinkStatus>;
  activeCount: number;
}> {
  const { sheetsGet, ensureSheet } = await import("./mahavtaar.server");

  let rawRows: string[][] = [];
  try {
    rawRows = await sheetsGet(`${CASHIER_LINK_TAB}!A2:H`);
  } catch {
    await ensureSheet(CASHIER_LINK_TAB, CASHIER_LINK_HEADERS).catch(() => undefined);
  }

  // Parse activities
  const activities: CashierLinkActivity[] = (rawRows ?? [])
    .map((r, i) => {
      const executive = (r[1] ?? "").trim();
      if (!executive) return null;
      const act = (r[2] ?? "").trim().toUpperCase();
      const action: CashierLinkAction = act === "ON" ? "ON" : "OFF";
      const durationSeconds = Number(String(r[5] ?? "0").replace(/[^0-9.-]/g, "")) || 0;
      return {
        id: (r[0] ?? "").trim() || `CLK-${i + 2}`,
        executive,
        action,
        date: (r[3] ?? "").trim(),
        time: (r[4] ?? "").trim(),
        durationSeconds,
        durationDisplay:
          (r[6] ?? "").trim() || (action === "OFF" ? formatDuration(durationSeconds) : "—"),
        createdAt: (r[7] ?? "").trim() || new Date().toISOString(),
        rowNumber: i + 2,
      };
    })
    .filter((a): a is CashierLinkActivity => a !== null);

  // Compute status per executive
  const executiveStatuses: Record<string, ExecutiveLinkStatus> = {};
  for (const exec of EXECUTIVES) {
    executiveStatuses[exec] = {
      executive: exec,
      isOnline: false,
      lastAction: null,
      lastDate: null,
      lastTime: null,
      onCreatedAt: null,
      lastDurationDisplay: null,
    };
  }

  // Process activities in chronological order to find current state
  for (const act of activities) {
    const cur = executiveStatuses[act.executive] ?? {
      executive: act.executive,
      isOnline: false,
      lastAction: null,
      lastDate: null,
      lastTime: null,
      onCreatedAt: null,
      lastDurationDisplay: null,
    };

    cur.lastAction = act.action;
    cur.lastDate = act.date;
    cur.lastTime = act.time;

    if (act.action === "ON") {
      cur.isOnline = true;
      cur.onCreatedAt = act.createdAt;
    } else {
      cur.isOnline = false;
      cur.onCreatedAt = null;
      cur.lastDurationDisplay = act.durationDisplay;
    }

    executiveStatuses[act.executive] = cur;
  }

  const activeCount = Object.values(executiveStatuses).filter((s) => s.isOnline).length;

  // Return activities latest first for history display
  const sortedActivities = [...activities].reverse();

  return {
    activities: sortedActivities,
    executiveStatuses,
    activeCount,
  };
}

export const getCashierLinkData = createServerFn({ method: "GET" }).handler(async () => {
  return await readCashierLinkActivities();
});

const actionSchema = z.object({
  executive: z.enum(EXECUTIVES),
  action: z.enum(["ON", "OFF"]),
});

export const recordCashierLinkAction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => actionSchema.parse(d))
  .handler(async ({ data }) => {
    const { sheetsAppend, ensureSheet } = await import("./mahavtaar.server");
    await ensureSheet(CASHIER_LINK_TAB, CASHIER_LINK_HEADERS);

    // Read current data to prevent duplicate or invalid actions
    const currentData = await readCashierLinkActivities();
    const currentStatus = currentData.executiveStatuses[data.executive];

    if (data.action === "ON" && currentStatus?.isOnline) {
      throw new Error(
        `Cashier ID Link is already ON for ${data.executive}. Duplicate ON action prevented.`,
      );
    }

    if (data.action === "OFF" && (!currentStatus || !currentStatus.isOnline)) {
      throw new Error(
        `Cashier ID Link is already OFF for ${data.executive}. Duplicate OFF action prevented.`,
      );
    }

    const now = new Date();
    const id = `CLK-${Date.now()}`;
    const date = todayISO(now);
    const time = nowTime(now);
    const createdAt = now.toISOString();

    let durationSeconds = 0;
    let durationDisplay = "—";

    if (data.action === "OFF") {
      // Find the most recent ON activity for this executive
      const lastOnActivity = currentData.activities.find(
        (a) => a.executive === data.executive && a.action === "ON",
      );

      if (lastOnActivity && lastOnActivity.createdAt) {
        const onTime = new Date(lastOnActivity.createdAt).getTime();
        const offTime = now.getTime();
        if (!Number.isNaN(onTime) && offTime > onTime) {
          durationSeconds = Math.round((offTime - onTime) / 1000);
          durationDisplay = formatDuration(durationSeconds);
        }
      }
    }

    await sheetsAppend(`${CASHIER_LINK_TAB}!A:H`, [
      [id, data.executive, data.action, date, time, durationSeconds, durationDisplay, createdAt],
    ]);

    return {
      ok: true as const,
      activity: {
        id,
        executive: data.executive,
        action: data.action,
        date,
        time,
        durationSeconds,
        durationDisplay,
        createdAt,
      },
    };
  });
