import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSession } from "./auth.functions";
import { readCollections } from "./mahavtaar.functions";

const REVIEW_TAB = "ReceiptReview";
const REVIEW_HEADERS = [
  "Receipt Key",
  "Row Number",
  "Loan Number",
  "Receipt URL",
  "Status",
  "Reason",
  "Marked By",
  "Marked At",
];

function receiptKey(row: number, url: string) {
  return `${row}::${url.trim()}`;
}

export const getReceiptGallery = createServerFn({ method: "GET" }).handler(async () => {
  await requireSession("Admin");
  const { sheetsGet, ensureSheetStrict } = await import("./mahavtaar.server");
  await ensureSheetStrict(REVIEW_TAB, REVIEW_HEADERS);
  const [collections, reviews] = await Promise.all([
    readCollections(),
    sheetsGet(`${REVIEW_TAB}!A2:H`),
  ]);

  const reviewByKey = new Map<
    string,
    { status: string; reason: string; markedBy: string; markedAt: string }
  >();
  for (const row of reviews) {
    const key = (row[0] ?? "").trim();
    if (!key) continue;
    reviewByKey.set(key, {
      status: (row[4] ?? "Valid").trim() || "Valid",
      reason: (row[5] ?? "").trim(),
      markedBy: (row[6] ?? "").trim(),
      markedAt: (row[7] ?? "").trim(),
    });
  }

  const receipts = collections.flatMap((entry) =>
    (entry.receiptLinks ?? [])
      .filter((url: string) => Boolean(url?.trim()))
      .map((url: string) => {
        const key = receiptKey(entry.row, url);
        const review = reviewByKey.get(key);
        return {
          key,
          rowNumber: entry.row,
          loanNumber: entry.loanId,
          executive: entry.executive,
          paymentDate: entry.date,
          amount: entry.amount,
          url,
          status: review?.status ?? "Valid",
          reason: review?.reason ?? "",
          markedBy: review?.markedBy ?? "",
          markedAt: review?.markedAt ?? "",
        };
      }),
  );

  return { receipts };
});

export const setReceiptValidity = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        receiptKeys: z.array(z.string().trim().min(1).max(1000)).min(1).max(100),
        status: z.enum(["Invalid", "Valid"]),
        reason: z.string().trim().max(300).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const session = await requireSession("Admin");
    const { sheetsGet, sheetsUpdateStrict, sheetsAppendStrict, ensureSheetStrict } =
      await import("./mahavtaar.server");
    await ensureSheetStrict(REVIEW_TAB, REVIEW_HEADERS);
    const existing = await sheetsGet(`${REVIEW_TAB}!A2:H`);
    const rowByKey = new Map<string, number>();
    existing.forEach((row, index) => {
      const key = (row[0] ?? "").trim();
      if (key) rowByKey.set(key, index + 2);
    });

    const now = new Date().toISOString();
    const selected = new Set(data.receiptKeys);
    const gallery = await readCollections();
    const knownKeys = new Set(
      gallery.flatMap((entry) =>
        (entry.receiptLinks ?? []).map((url: string) => receiptKey(entry.row, url)),
      ),
    );
    const unknown = [...selected].filter((key) => !knownKeys.has(key));
    if (unknown.length)
      throw new Error("One or more selected receipts could not be found. Refresh the gallery.");

    for (const key of selected) {
      const [rowText] = key.split("::");
      const rowNumber = Number(rowText);
      const entry = gallery.find((item) => item.row === rowNumber);
      const url =
        entry?.receiptLinks?.find((link: string) => receiptKey(rowNumber, link) === key) ?? "";
      const values = [
        [key, rowNumber, entry?.loanId ?? "", url, data.status, data.reason, session.name, now],
      ];
      const targetRow = rowByKey.get(key);
      if (targetRow) {
        await sheetsUpdateStrict(`${REVIEW_TAB}!A${targetRow}:H${targetRow}`, values);
      } else {
        await sheetsAppendStrict(`${REVIEW_TAB}!A:H`, values);
      }
    }
    return { ok: true as const, updated: selected.size, status: data.status };
  });
