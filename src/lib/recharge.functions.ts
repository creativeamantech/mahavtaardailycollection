import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import { ensureRechargeStorage, uploadRechargeProof } from "./recharge-storage.server";

const GATEWAY = "https://connector-gateway.lovable.dev";
const authHeaders = () => {
  const token = process.env["LOVABLE_API_KEY"];
  const key = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!token || !key) throw new Error("Google Sheets connector is not configured.");
  return {
    Authorization: "Bearer " + token,
    "X-Connection-Api-Key": key,
    "Content-Type": "application/json",
  };
};
async function sheetRequest(path: string, init?: RequestInit) {
  const { spreadsheetId } = await ensureRechargeStorage();
  const response = await fetch(
    GATEWAY + path.replace("__SPREADSHEET_ID__", encodeURIComponent(spreadsheetId)),
    {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new Error("Recharge data operation failed (" + response.status + ").");
  return response.json() as Promise<{ values?: string[][] }>;
}
async function readTab(tab: string) {
  const result = await sheetRequest(
    "/google_sheets/v4/spreadsheets/__SPREADSHEET_ID__/values/" +
      encodeURIComponent("'" + tab + "'!A2:M"),
  );
  return result.values ?? [];
}
async function appendRow(tab: string, values: (string | number)[]) {
  await sheetRequest(
    "/google_sheets/v4/spreadsheets/__SPREADSHEET_ID__/values/" +
      encodeURIComponent("'" + tab + "'!A:M") +
      ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
    {
      method: "POST",
      body: JSON.stringify({ values: [values] }),
    },
  );
}
async function updateRow(tab: string, row: number, range: string, values: (string | number)[][]) {
  await sheetRequest(
    "/google_sheets/v4/spreadsheets/__SPREADSHEET_ID__/values/" +
      encodeURIComponent("'" + tab + "'!" + range.replace("{row}", String(row))) +
      "?valueInputOption=RAW",
    {
      method: "PUT",
      body: JSON.stringify({ values }),
    },
  );
}
function configuredExecutives() {
  return (process.env["LOGIN_CREDENTIALS"] ?? "")
    .split(/[;\r\n]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => {
      const [name, role] = v.split("_");
      return { name: name?.trim() ?? "", role: role?.trim().toLowerCase() ?? "" };
    })
    .filter((v) => v.name && v.role === "executive");
}
const imageInput = z.object({
  name: z.string().trim().min(1).max(120),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(1).max(16_800_000),
});
async function uploadProof(file: z.infer<typeof imageInput>) {
  return uploadRechargeProof(
    "recharge-" + Date.now() + "-" + file.name,
    file.mimeType,
    file.base64,
  );
}
const money = (value: string | undefined) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
async function readState(name: string, isAdmin: boolean) {
  const [numberRows, creditRows, requestRows] = await Promise.all([
    readTab("Executive Numbers"),
    readTab("Credits"),
    readTab("Sheet1"),
  ]);
  const numbers = numberRows.find(
    (r) =>
      (r[1] ?? "").trim().toLowerCase() === name.toLowerCase() &&
      (r[4] ?? "TRUE").toUpperCase() !== "FALSE",
  );
  const myCredits = creditRows.filter(
    (r) => (r[2] ?? "").trim().toLowerCase() === name.toLowerCase(),
  );
  const myRequests = requestRows.filter(
    (r) => (r[2] ?? "").trim().toLowerCase() === name.toLowerCase(),
  );
  const creditTotal = myCredits.reduce((sum, r) => sum + money(r[3]), 0);
  const used = myRequests
    .filter((r) => ["approved", "completed"].includes((r[7] ?? "").toLowerCase()))
    .reduce((sum, r) => sum + money(r[4]), 0);
  const slotCycles = [1, 2].map((slot) => {
    const latest = myRequests
      .filter((r) => (r[11] ?? "") === String(slot) && (r[7] ?? "").toLowerCase() !== "rejected")
      .map((r) => Date.parse(r[6] ?? ""))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    const nextAt = latest ? latest + 28 * 24 * 60 * 60 * 1000 : 0;
    return {
      slot,
      lastRechargeAt: latest ? new Date(latest).toISOString() : null,
      nextAvailableAt: nextAt ? new Date(nextAt).toISOString() : null,
      available: !nextAt || Date.now() >= nextAt,
    };
  });
  const allCredits = creditRows.map((r) => ({
    id: r[0] ?? "",
    name: r[2] ?? "",
    amount: money(r[3]),
    date: r[4] ?? "",
    month: r[5] ?? "",
    by: r[6] ?? "",
    screenshot: r[7] ?? "",
    reference: r[8] ?? "",
    note: r[11] ?? "",
  }));
  const allRequests = requestRows.map((r) => ({
    id: r[0] ?? "",
    executive: r[2] ?? "",
    number: r[3] ?? "",
    amount: money(r[4]),
    screenshot: r[5] ?? "",
    date: r[6] ?? "",
    status: r[7] || "Completed",
    note: r[8] ?? "",
    slot: r[11] ?? "",
  }));
  return {
    numbers: [numbers?.[2] ?? "", numbers?.[3] ?? ""],
    creditTotal: isAdmin ? creditRows.reduce((sum, r) => sum + money(r[3]), 0) : creditTotal,
    used: isAdmin
      ? requestRows
          .filter((r) => ["approved", "completed"].includes((r[7] ?? "").toLowerCase()))
          .reduce((sum, r) => sum + money(r[4]), 0)
      : used,
    balance: isAdmin
      ? creditRows.reduce((sum, r) => sum + money(r[3]), 0) -
        requestRows
          .filter((r) => ["approved", "completed"].includes((r[7] ?? "").toLowerCase()))
          .reduce((sum, r) => sum + money(r[4]), 0)
      : creditTotal - used,
    slotCycles: isAdmin ? [] : slotCycles,
    credits: isAdmin
      ? allCredits
      : allCredits.filter((r) => r.name.toLowerCase() === name.toLowerCase()),
    requests: isAdmin
      ? allRequests
      : allRequests.filter((r) => r.executive.toLowerCase() === name.toLowerCase()),
  };
}
export const getRechargeData = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSession();
  const state = await readState(session.name, session.role === "Admin");
  return {
    ...state,
    session,
    executives: session.role === "Admin" ? configuredExecutives().map((u) => u.name) : [],
  };
});
export const saveRechargeNumbers = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z
      .object({
        numbers: z
          .array(
            z
              .string()
              .trim()
              .refine((v) => v === "" || /^[0-9+() -]{8,20}$/.test(v), "Invalid calling number"),
          )
          .max(2),
      })
      .parse(v),
  )
  .handler(async ({ data }) => {
    const session = await requireSession("Executive");
    const clean = data.numbers.map((n) => (n.trim() ? n.replace(/[() -]/g, "") : ""));
    if (clean.filter(Boolean).length !== new Set(clean.filter(Boolean)).size)
      throw new Error("Dono slots mein same number save nahi kar sakte.");
    const rows = await readTab("Executive Numbers");
    const index = rows.findIndex(
      (r) => (r[1] ?? "").trim().toLowerCase() === session.name.toLowerCase(),
    );
    const record = [
      "EX-" + session.name,
      session.name,
      clean[0] ?? "",
      clean[1] ?? "",
      "TRUE",
      new Date().toISOString(),
      session.name,
      "",
    ];
    if (index < 0) await appendRow("Executive Numbers", record);
    else await updateRow("Executive Numbers", index + 2, "A{row}:H{row}", [record]);
    return { ok: true };
  });
export const createRechargeCredit = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z
      .object({
        executive: z.string().trim().min(1).max(100),
        amount: z.number().positive().max(1000000),
        image: imageInput,
        reference: z.string().trim().max(100).optional(),
        note: z.string().trim().max(300).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data }) => {
    const admin = await requireSession("Admin");
    if (!configuredExecutives().some((u) => u.name.toLowerCase() === data.executive.toLowerCase()))
      throw new Error("Executive not found.");
    const screenshot = await uploadProof(data.image);
    const now = new Date();
    const id = "CR-" + now.getTime();
    await appendRow("Credits", [
      id,
      "EX-" + data.executive,
      data.executive,
      data.amount,
      now.toISOString(),
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
      }).format(now),
      admin.name,
      screenshot,
      data.reference ?? "",
      0,
      0,
      data.note ?? "",
    ]);
    return { ok: true, id };
  });
export const createRechargeRequest = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z
      .object({
        slot: z.enum(["1", "2"]),
        number: z.string().trim().min(8).max(20),
        amount: z.number().positive().max(100000),
        image: imageInput,
      })
      .parse(v),
  )
  .handler(async ({ data }) => {
    const session = await requireSession("Executive");
    const state = await readState(session.name, false);
    const number = data.number.replace(/[() -]/g, "");
    if (state.numbers[data.slot === "1" ? 0 : 1]?.replace(/[() -]/g, "") !== number)
      throw new Error("Selected number is not saved in this recharge slot.");
    const slotRows = await readTab("Sheet1");
    const lastSlotRecharge = slotRows
      .filter(
        (r) =>
          (r[2] ?? "").trim().toLowerCase() === session.name.toLowerCase() &&
          (r[11] ?? "") === data.slot &&
          (r[7] ?? "").toLowerCase() !== "rejected",
      )
      .map((r) => Date.parse(r[6] ?? ""))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (lastSlotRecharge && Date.now() < lastSlotRecharge + 28 * 24 * 60 * 60 * 1000) {
      const availableOn = new Date(lastSlotRecharge + 28 * 24 * 60 * 60 * 1000).toLocaleString(
        "en-IN",
        { timeZone: "Asia/Kolkata" },
      );
      throw new Error(
        "Slot " + data.slot + " ka next recharge " + availableOn + " ke baad allowed hai.",
      );
    }
    const screenshot = await uploadProof(data.image);
    const now = new Date();
    const id = "RQ-" + now.getTime();
    await appendRow("Sheet1", [
      id,
      "EX-" + session.name,
      session.name,
      data.number,
      data.amount,
      screenshot,
      now.toISOString(),
      "Completed",
      "Self-recorded recharge",
      now.toISOString(),
      session.name,
      data.slot,
    ]);
    return { ok: true, id };
  });
export const reviewRechargeRequest = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z
      .object({
        id: z.string().min(1).max(80),
        status: z.enum(["Approved", "Rejected"]),
        note: z.string().trim().max(300).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data }) => {
    await requireSession("Admin");
    const rows = await readTab("Sheet1");
    const index = rows.findIndex((r) => (r[0] ?? "") === data.id);
    if (index < 0) throw new Error("Recharge request not found.");
    if ((rows[index]?.[7] ?? "").toLowerCase() !== "pending")
      throw new Error("This request has already been reviewed.");
    await updateRow("Sheet1", index + 2, "H{row}:K{row}", [
      [data.status, data.note ?? "", new Date().toISOString(), "Admin"],
    ]);
    return { ok: true };
  });
