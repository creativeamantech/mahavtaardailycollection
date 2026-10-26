import { normalizeSheetDate, normalizeSheetTime } from "./executives";

export type TransactionStatus = "SUCCESS" | "PENDING" | "FAILED" | "UNKNOWN";

export interface ParsedReceiptResult {
  isReceipt: boolean;
  transactionStatus: TransactionStatus;
  billAmount: number | null;
  totalPaidAmount: number | null;
  convenienceFee: number | null;
  effectiveAmount: number | null;
  paymentDate: string | null; // YYYY-MM-DD
  paymentTime: string | null; // hh:mm am/pm
  loanId: string | null;
  utrNumber: string | null;
  paymentApp: string | null;
  rawText: string;
  confidence: number;
  verificationSummary: string;
}

export interface ReceiptComparisonResult {
  statusOk: boolean;
  amountMatches: boolean;
  dateMatches: boolean;
  timeMatches: boolean;
  loanIdMatches: boolean | null; // null if loanId not present on receipt
  overallMatch: boolean;
  suggestedAmount: number | null;
  suggestedDate: string | null;
  suggestedTime: string | null;
  suggestedLoanId: string | null;
  amansRemarkText: string;
  hindiDiscrepancyNote: string;
}

const MONTHS_MAP: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  "0ct": "10",
  "0ctober": "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

/**
 * Normalizes a line of OCR text so comma-formatted Indian numbers with spaces
 * (e.g. "Z2, 295" or "1, 510") become "Z2,295" and "1,510".
 */
function normalizeOcrLineNumbers(line: string): string {
  return line.replace(/([0-9]),\s+([0-9]{3})\b/g, "$1,$2");
}

/**
 * Cleans an OCR number string, handling Indian comma formatting and common Tesseract ₹ misreads
 * (such as Z, %, ¥, &, ?, ₹).
 */
function parseIndianCurrencyString(raw: string): number | null {
  let cleaned = normalizeOcrLineNumbers(raw).trim();
  cleaned = cleaned.replace(/^(?:₹|Rs\.?|INR|amt:?|amount:?|\(0)\s*/i, "").trim();
  cleaned = cleaned.replace(/^[zZ?₹%¥&]\s*/, "");
  cleaned = cleaned.replace(/\s+/g, "");

  const match = /^([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/.exec(cleaned);
  if (!match) return null;

  const numStr = match[1]!.replace(/,/g, "");
  const val = Number(numStr);
  if (!Number.isFinite(val) || val <= 0 || val > 10_000_000) return null;
  return val;
}

/**
 * Checks if a 5-digit number like 23299, 33000, 32919, 22919 is actually a 4-digit number
 * where the leading ₹ symbol was misread by Tesseract as '2', '3', or '7'.
 */
function maybeStripRupeePrefixDigit(val: number): number | null {
  const s = String(Math.round(val));
  if (s.length === 5 && /^[237][1-9]\d{3}$/.test(s)) {
    return Number(s.slice(1));
  }
  return null;
}

/**
 * Extracts all candidate amounts from receipt text, separating Bill Amount, Convenience Fee, and Total Amount.
 */
function extractAmounts(text: string): {
  billAmount: number | null;
  totalPaidAmount: number | null;
  convenienceFee: number | null;
  effectiveAmount: number | null;
} {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => normalizeOcrLineNumbers(l.trim()))
    .filter(Boolean);

  // Filter out PhonePe / GPay promo and ad lines ("Watch 2000+ Shows Daily!", "up to 10,000", etc.)
  const lines = rawLines.filter(
    (l) =>
      !/watch\s*2000|shows\s*daily|safer\s*payments|up\s*to\s*10,000|fingerprint|scratch\s*card/i.test(
        l,
      ),
  );

  let splitExpenseAmount: number | null = null;
  let cashDropAmount: number | null = null;
  let inlinePaymentAmount: number | null = null;
  let billAmount: number | null = null;
  let billerEmiAmount: number | null = null;
  let totalPaidAmount: number | null = null;
  let convenienceFee: number | null = null;
  let hasPlatformFeeMention = false;

  const rawCandidates: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const nextLine = lines[i + 1] ?? "";
    const combined = `${line} ${nextLine}`;

    // 1. High-confidence PhonePe UPI "<amount> Split Expense" anchor
    const splitMatch =
      /(?:[₹%¥Zz?&237]|Rs\.?|INR)?\s*([0-9]{1,2},[0-9]{3}(?:\.[0-9]{1,2})?|[0-9]{3,6}(?:\.[0-9]{1,2})?)\s+Split\s*Expense/i.exec(
        combined,
      );
    if (splitMatch && !splitExpenseAmount) {
      const val = parseIndianCurrencyString(splitMatch[1]!);
      if (val && val >= 50 && val <= 500_000) {
        splitExpenseAmount = val;
      }
    }

    // 2. High-confidence Cash Drop / "Rs 3035.00 has ... been credited" anchor
    const creditedMatch =
      /(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s+has\b[\s\S]{0,15}?\bbeen\s+credited/i.exec(
        combined,
      ) || /\bRs\.?\s*([0-9]{3,6}\.[0-9]{2})\b/i.exec(line);
    if (creditedMatch && !cashDropAmount) {
      const val = parseIndianCurrencyString(creditedMatch[1]!);
      if (val && val >= 50 && val <= 500_000) {
        cashDropAmount = val;
      }
    }

    // 3. Google Pay / BBPS inline "(0 5,380.00 payment" anchor
    const inlinePayMatch =
      /(?:\(0|₹|Rs\.?)\s*([0-9]{1,2},[0-9]{3}(?:\.[0-9]{1,2})?|[0-9]{3,6}\.[0-9]{2})\s*payment/i.exec(
        combined,
      );
    if (inlinePayMatch && !inlinePaymentAmount) {
      const val = parseIndianCurrencyString(inlinePayMatch[1]!);
      if (val && val >= 50 && val <= 500_000) {
        inlinePaymentAmount = val;
      }
    }

    // 4. Platform / Convenience Fee detection
    if (/(?:convenience|platform|ccf|processing)\s*fee/i.test(line)) {
      hasPlatformFeeMention = true;
      // Note: "+₹3" on PhonePe is frequently read by Tesseract as "+33" or "+3"
      if (/\+33\b/.test(combined)) {
        convenienceFee = 3;
      } else {
        const feeMatch =
          /\+\s*(?:₹|Rs\.?|INR)?\s*([0-9]{1,3}(?:\.[0-9]{1,2})?)\b/i.exec(combined) ||
          /(?:₹|Rs\.?|INR)\s*([0-9]{1,3}(?:\.[0-9]{1,2})?)\b/i.exec(combined);
        if (feeMatch) {
          const fee = Number(feeMatch[1]);
          if (fee === 33) {
            convenienceFee = 3;
          } else if (fee > 0 && fee <= 200) {
            convenienceFee = fee;
          }
        }
      }
      continue;
    }

    // Ignore Late Charges, Bounce Charges, and EMI OverDue Amount lines so they don't pollute amounts
    if (/(?:late\s*charg|bounce\s*charg|over\s*due\s*amount)/i.test(line)) {
      continue;
    }

    // 5. Biller EMI Amount (in Bill Details section)
    if (/\bemi\s*amount\b/i.test(line) && !/over\s*due/i.test(line)) {
      const emiMatches = [
        ...combined.matchAll(/\b([0-9]{1,2},[0-9]{3}(?:\.[0-9]{1,2})?|[0-9]{3,6}\.[0-9]{2})\b/g),
      ];
      for (const m of emiMatches) {
        const val = parseIndianCurrencyString(m[1]!);
        if (val && val >= 100 && val <= 500_000) {
          billerEmiAmount = val;
          break;
        }
      }
      continue;
    }

    // 6. Explicit "Bill Amount" (in Payment Details section)
    if (/\bbill\s*amount\b/i.test(line)) {
      const amtMatches = [
        ...line.matchAll(
          /(?:[₹%¥Zz?&]|Rs\.?|INR|\b)\s*([0-9]{1,2},[0-9]{3}(?:\.[0-9]{1,2})?|[0-9]{3,6}(?:\.[0-9]{1,2})?)\b/gi,
        ),
      ];
      for (const m of amtMatches) {
        const val = parseIndianCurrencyString(m[1]!);
        if (val && val >= 50 && val <= 500_000) {
          billAmount = val;
          rawCandidates.push(val);
          break;
        }
      }
    }

    // 7. Explicit "Total Amount" / "Amount Paid" / "Debited from" / "IDFC FIRST Bank" header amount
    if (
      /(?:total\s*amount|amount\s*paid|total\s*paid|paid\s*amount|debited\s*from|idfc\s*first\s*bank|xxxxx)/i.test(
        line,
      )
    ) {
      const targetStr = /debited\s*from/i.test(line) ? combined : line;
      const amtMatches = [
        ...targetStr.matchAll(
          /(?:[₹%¥Zz?&]|Rs\.?|INR|\b)\s*([0-9]{1,2},[0-9]{3}(?:\.[0-9]{1,2})?)\b/gi,
        ),
      ];
      for (const m of amtMatches) {
        const val = parseIndianCurrencyString(m[1]!);
        if (val && val >= 50 && val <= 500_000) {
          rawCandidates.push(val);
          if (/total\s*amount/i.test(line)) {
            totalPaidAmount = val;
          } else if (!totalPaidAmount) {
            totalPaidAmount = val;
          }
        }
      }
    }

    // 8. Collect comma-formatted numbers across the line
    const commaMatches = [
      ...line.matchAll(/(?:[₹%¥Zz?&]|Rs\.?|INR)?\s*\b([0-9]{1,2},[0-9]{3}(?:\.[0-9]{1,2})?)\b/g),
    ];
    for (const m of commaMatches) {
      const val = parseIndianCurrencyString(m[1]!);
      if (val && val >= 50 && val <= 500_000) {
        rawCandidates.push(val);
      }
    }
  }

  // Fast-path for "Split Expense" (PhonePe direct UPI) or "Cash Drop" or inline GPay amount
  if (splitExpenseAmount !== null) {
    return {
      billAmount: splitExpenseAmount,
      totalPaidAmount: splitExpenseAmount,
      convenienceFee: null,
      effectiveAmount: splitExpenseAmount,
    };
  }
  if (cashDropAmount !== null) {
    return {
      billAmount: cashDropAmount,
      totalPaidAmount: cashDropAmount,
      convenienceFee: null,
      effectiveAmount: cashDropAmount,
    };
  }
  if (inlinePaymentAmount !== null && !billAmount && !totalPaidAmount) {
    return {
      billAmount: inlinePaymentAmount,
      totalPaidAmount: inlinePaymentAmount,
      convenienceFee: null,
      effectiveAmount: inlinePaymentAmount,
    };
  }

  // De-prefix 5-digit numbers where leading '2', '3', or '7' is a misread '₹' symbol
  // e.g. 23,299 -> 3,299; 33,000 -> 3,000; 32,919 & 22,919 -> 2,919
  const fourDigitCandidates = new Set<number>();
  const strippedCounts = new Map<number, number>();

  for (const c of rawCandidates) {
    if (c < 10_000) {
      fourDigitCandidates.add(c);
    } else {
      const stripped = maybeStripRupeePrefixDigit(c);
      if (stripped) {
        strippedCounts.set(stripped, (strippedCounts.get(stripped) ?? 0) + 1);
      }
    }
  }
  if (billerEmiAmount && billerEmiAmount < 10_000) {
    fourDigitCandidates.add(billerEmiAmount);
  }

  function fixRupeePrefix(val: number | null): number | null {
    if (val === null) return null;
    const stripped = maybeStripRupeePrefixDigit(val);
    if (!stripped) return val;

    // Corroborate: if the 4-digit stripped value is close to any 4-digit number on the receipt
    // (within ₹50, e.g. 3000 vs 3003, or 2919 vs 2916) OR appears multiple times with different leading digits (32919 & 22919)
    for (const f of fourDigitCandidates) {
      if (Math.abs(stripped - f) <= 50) {
        return stripped;
      }
    }
    if ((strippedCounts.get(stripped) ?? 0) >= 2) {
      return stripped;
    }
    return val;
  }

  billAmount = fixRupeePrefix(billAmount);
  totalPaidAmount = fixRupeePrefix(totalPaidAmount);

  const normalizedCandidates = rawCandidates.map((c) => fixRupeePrefix(c)!);

  if (!totalPaidAmount && normalizedCandidates.length > 0) {
    const counts = new Map<number, number>();
    for (const c of normalizedCandidates) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    totalPaidAmount = sorted[0]?.[0] ?? null;
  }

  // Default PhonePe BBPS platform fee is ₹3 when "Platform fee" is mentioned on the receipt
  if (hasPlatformFeeMention && convenienceFee === null) {
    convenienceFee = 3;
  }

  // If both billAmount and totalPaidAmount exist, check if their difference is the convenience fee
  if (
    billAmount !== null &&
    totalPaidAmount !== null &&
    totalPaidAmount > billAmount &&
    totalPaidAmount - billAmount <= 100
  ) {
    convenienceFee = Number((totalPaidAmount - billAmount).toFixed(2));
  }

  // If totalPaidAmount and convenienceFee exist, but billAmount was not read (e.g. Row 10: 2,743 with ₹3 platform fee)
  if (
    billAmount === null &&
    totalPaidAmount !== null &&
    convenienceFee !== null &&
    totalPaidAmount > convenienceFee
  ) {
    billAmount = Number((totalPaidAmount - convenienceFee).toFixed(2));
  }

  // If billAmount is still null, check if two candidate amounts on the receipt differ by 1..50 (e.g. 3299 and 3296)
  if (billAmount === null && normalizedCandidates.length >= 2) {
    const unique = [...new Set(normalizedCandidates)].sort((a, b) => b - a);
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const diff = Number((unique[i]! - unique[j]!).toFixed(2));
        if (diff > 0 && diff <= 50) {
          totalPaidAmount = unique[i]!;
          billAmount = unique[j]!;
          convenienceFee = diff;
          break;
        }
      }
      if (billAmount !== null) break;
    }
  }

  const effectiveAmount = billAmount ?? totalPaidAmount ?? billerEmiAmount;

  return {
    billAmount,
    totalPaidAmount,
    convenienceFee,
    effectiveAmount,
  };
}

/**
 * Extracts payment date (YYYY-MM-DD) and time (hh:mm am/pm) from receipt text,
 * including fallback decoding of PhonePe / BBPS / Cash Drop Transaction IDs.
 */
function extractDateAndTime(text: string): {
  paymentDate: string | null;
  paymentTime: string | null;
} {
  let paymentDate: string | null = null;
  let paymentTime: string | null = null;

  // 1. Extract Time: e.g. "02:15 PM", "12:45:10 pm", "11:31am", "8:57pm"
  const timeMatch =
    /\b(0?[1-9]|1[0-2]):([0-5][0-9])(?::[0-5][0-9])?\s*([aApP][mM])\b/.exec(text) ||
    /\b([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])\b/.exec(text);

  if (timeMatch) {
    paymentTime = normalizeSheetTime(timeMatch[0]);
  }

  // 2. Extract Date Pattern A: "01 October 2026", "01 Oct 2026", "1October 2026", "10ct 2026"
  const dmyAlpha =
    /\b([0-3]?[0-9])\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[a-z]*[.,]?\s+(20[2-3][0-9])\b/i.exec(
      text,
    );
  if (dmyAlpha) {
    const day = dmyAlpha[1]!.padStart(2, "0");
    const monPrefix = dmyAlpha[2]!.toLowerCase().slice(0, 3);
    const month = MONTHS_MAP[monPrefix] ?? "01";
    const year = dmyAlpha[3]!;
    paymentDate = `${year}-${month}-${day}`;
  }

  // 3. Extract Date Pattern B: "Oct 1, 2026", "October 08 2026"
  if (!paymentDate) {
    const mdyAlpha =
      /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[a-z]*\s+([0-3]?[0-9])[.,]?\s+(20[2-3][0-9])\b/i.exec(
        text,
      );
    if (mdyAlpha) {
      const monPrefix = mdyAlpha[1]!.toLowerCase().slice(0, 3);
      const month = MONTHS_MAP[monPrefix] ?? "01";
      const day = mdyAlpha[2]!.padStart(2, "0");
      const year = mdyAlpha[3]!;
      paymentDate = `${year}-${month}-${day}`;
    }
  }

  // 4. Handle OCR "0ct" where capital O in Oct was read as digit 0 (e.g. "10ct 2026" -> 1 Oct 2026)
  if (!paymentDate) {
    const zeroOct = /\b([0-3]?[0-9])\s*0ct(?:ober)?[.,]?\s+(20[2-3][0-9])\b/i.exec(text);
    if (zeroOct) {
      const day = zeroOct[1]!.padStart(2, "0");
      const year = zeroOct[2]!;
      paymentDate = `${year}-10-${day}`;
    }
  }

  // 5. Extract Date & Time from PhonePe / BBPS / Cash Drop Transaction IDs!
  // Examples:
  //   NB26100120094440290950312 -> 2026-10-01 at 20:09
  //   NB26100211313066567110592 -> 2026-10-02 at 11:31
  //   T2610012236400169973120   -> 2026-10-01 at 22:36
  //   PH610021411 206922        -> 2026-10-02 at 14:11
  const txIdMatch =
    /\b(?:NB|T)(2[4-9])(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([01][0-9]|2[0-3])([0-5][0-9])\d{5,}/i.exec(
      text,
    ) ||
    /\bPH([4-9])(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([01][0-9]|2[0-3])([0-5][0-9])\b/i.exec(
      text,
    );

  if (txIdMatch) {
    const yrRaw = txIdMatch[1]!;
    const year = yrRaw.length === 1 ? `202${yrRaw}` : `20${yrRaw}`;
    const month = txIdMatch[2]!;
    const day = txIdMatch[3]!;
    const hh = txIdMatch[4]!;
    const mm = txIdMatch[5]!;
    if (!paymentDate) {
      paymentDate = `${year}-${month}-${day}`;
    }
    if (!paymentTime) {
      paymentTime = normalizeSheetTime(`${hh}:${mm}`);
    }
  }

  // 6. Extract Date Pattern C: "02-10-2026", "08/10/2026", "2026-10-08"
  if (!paymentDate) {
    const isoOrDmy =
      /\b(20[2-3][0-9])[/-](0[1-9]|1[0-2])[/-](0[1-9]|[12][0-9]|3[01])\b/.exec(text) ||
      /\b(0[1-9]|[12][0-9]|3[01])[/-](0[1-9]|1[0-2])[/-](20[2-3][0-9])\b/.exec(text);
    if (isoOrDmy) {
      paymentDate = normalizeSheetDate(isoOrDmy[0]);
    }
  }

  // 7. Extract Date Pattern D: "18 Oct" without year (assume current year)
  if (!paymentDate) {
    const shortAlpha =
      /\b([0-3]?[0-9])\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i.exec(text);
    if (shortAlpha) {
      const day = shortAlpha[1]!.padStart(2, "0");
      const monPrefix = shortAlpha[2]!.toLowerCase().slice(0, 3);
      const month = MONTHS_MAP[monPrefix] ?? "01";
      const year = new Date().getFullYear();
      paymentDate = `${year}-${month}-${day}`;
    }
  }

  return { paymentDate, paymentTime };
}

/**
 * Extracts Loan ID (typically 8-10 digits on IDFC / Navi / BBPS biller lines) and 12-digit UTR / Ref ID.
 */
function extractLoanAndUtr(text: string): {
  loanId: string | null;
  utrNumber: string | null;
  paymentApp: string | null;
} {
  let paymentApp: string | null = null;
  if (/phonepe|split\s*expense|\bnb2[4-9]\d{10}|\bt2[4-9]\d{10}/i.test(text)) {
    paymentApp = "PhonePe";
  } else if (/google\s*pay|gpay|tez|pay\s*intermediary/i.test(text)) {
    paymentApp = "Google Pay";
  } else if (/paytm/i.test(text)) {
    paymentApp = "Paytm";
  } else if (/cash\s*drop/i.test(text)) {
    paymentApp = "IDFC Cash Drop";
  } else if (/\bnavi\b/i.test(text)) {
    paymentApp = "Navi";
  } else if (/idfc\s*first/i.test(text)) {
    paymentApp = "IDFC FIRST Bank";
  } else if (/bbps|bharat\s*bill\s*pay|bharat\s*connect/i.test(text)) {
    paymentApp = "BBPS";
  } else if (/amazon\s*pay/i.test(text)) {
    paymentApp = "Amazon Pay";
  } else if (/bhim/i.test(text)) {
    paymentApp = "BHIM UPI";
  }

  // Extract 12-digit UTR / UPI Ref No
  let utrNumber: string | null = null;
  const utrExplicit =
    /(?:utr|upi\s*ref\.?\s*(?:no|id)?|upi\s*transaction\s*id|ref\.?\s*(?:no|id)|transaction\s*id)[:\s#-]*([0-9]{12})\b/i.exec(
      text,
    );
  if (utrExplicit) {
    utrNumber = utrExplicit[1]!;
  } else {
    const any12 = /\b([0-9]{12})\b/.exec(text);
    if (any12) utrNumber = any12[1]!;
  }

  // Extract Loan Account Number:
  // 1. Check for "<loanId>.retail@idfcbank" (PhonePe/GPay UPI VPA format)
  let loanId: string | null = null;
  const vpaLoanMatch = /\b([0-9]{7,11})\.retail@idfc/i.exec(text);
  if (vpaLoanMatch) {
    loanId = vpaLoanMatch[1]!;
  }

  // 2. Check explicit labels ("Loan No", "Loan Account Number", "Loan number")
  if (!loanId) {
    const loanExplicit =
      /(?:loan\s*(?:id|no|number|account(?:\s*number)?|a\/c)|consumer\s*(?:no|number|id)|account\s*(?:no|number)|application\s*id|biller\s*id)[:\s#-]*([0-9]{7,11})\b/i.exec(
        text,
      );
    if (loanExplicit) {
      loanId = loanExplicit[1]!;
    }
  }

  // 3. Portfolio 9-digit Loan IDs starting with 15..19 (e.g. 184773074, 179944847, 167320168)
  if (!loanId) {
    const portfolioLoanMatch = /\b(1[5-9][0-9]{7})\b/.exec(text);
    if (portfolioLoanMatch) {
      loanId = portfolioLoanMatch[1]!;
    }
  }

  return { loanId, utrNumber, paymentApp };
}

/**
 * Determines whether the receipt shows a completed/successful payment vs failed/pending.
 */
function detectTransactionStatus(text: string): {
  isReceipt: boolean;
  transactionStatus: TransactionStatus;
} {
  const lower = text.toLowerCase();

  const hasReceiptKeywords =
    /paid|payment|transaction|utr|upi|bbps|biller|debited|amount|receipt|idfc|phonepe|google\s*pay|paytm|navi|emi|credited|split\s*expense/i.test(
      lower,
    );

  if (
    /\b(?:transaction\s*failed|payment\s*failed|failed|declined|rejected|cancelled|unsuccessful)\b/i.test(
      lower,
    )
  ) {
    return { isReceipt: hasReceiptKeywords, transactionStatus: "FAILED" };
  }

  if (
    /\b(?:payment\s*pending|transaction\s*pending|payment\s*processing|bill\s*payment\s*processing|processing|pending|initiated|in\s*progress)\b/i.test(
      lower,
    ) &&
    !/\b(?:successful|completed|paid\s*successfully|has\s*been\s*credited)\b/i.test(lower)
  ) {
    return { isReceipt: hasReceiptKeywords, transactionStatus: "PENDING" };
  }

  if (
    /\b(?:transaction\s*successful|payment\s*successful|paid\s*successfully|completed|bill\s*paid|loan\s*installment\s*paid|payment\s*complete|paid\s*to|has\s*been\s*credited|success)\b/i.test(
      lower,
    )
  ) {
    return { isReceipt: true, transactionStatus: "SUCCESS" };
  }

  return {
    isReceipt: hasReceiptKeywords,
    transactionStatus: hasReceiptKeywords ? "SUCCESS" : "UNKNOWN",
  };
}

/**
 * Pure deterministic parser that converts raw OCR text into a structured ParsedReceiptResult.
 */
export function parseReceiptText(rawText: string, confidence = 85): ParsedReceiptResult {
  const { isReceipt, transactionStatus } = detectTransactionStatus(rawText);
  const { billAmount, totalPaidAmount, convenienceFee, effectiveAmount } = extractAmounts(rawText);
  const { paymentDate, paymentTime } = extractDateAndTime(rawText);
  const { loanId, utrNumber, paymentApp } = extractLoanAndUtr(rawText);

  const parts: string[] = [];
  if (paymentApp) parts.push(paymentApp);
  parts.push(`Status: ${transactionStatus}`);
  if (effectiveAmount !== null) {
    if (convenienceFee && totalPaidAmount && totalPaidAmount !== effectiveAmount) {
      parts.push(`Bill ₹${effectiveAmount} (Total ₹${totalPaidAmount} - ₹${convenienceFee} fee)`);
    } else {
      parts.push(`Amount: ₹${effectiveAmount}`);
    }
  }
  if (paymentDate) parts.push(`Date: ${paymentDate}${paymentTime ? ` ${paymentTime}` : ""}`);
  if (loanId) parts.push(`Loan ID: ${loanId}`);
  if (utrNumber) parts.push(`UTR: ${utrNumber}`);

  return {
    isReceipt,
    transactionStatus,
    billAmount,
    totalPaidAmount,
    convenienceFee,
    effectiveAmount,
    paymentDate,
    paymentTime,
    loanId,
    utrNumber,
    paymentApp,
    rawText,
    confidence,
    verificationSummary: parts.join(" | "),
  };
}

/**
 * Compares a scanned receipt result against form or sheet values and produces match flags + Aman's Remarks text.
 */
export function compareReceiptWithEntry(
  scanned: ParsedReceiptResult,
  entry: {
    amount?: number | null;
    date?: string | null;
    time?: string | null;
    loanId?: string | null;
  },
): ReceiptComparisonResult {
  const statusOk = scanned.transactionStatus === "SUCCESS";

  const entryAmt = entry.amount && entry.amount > 0 ? Number(entry.amount) : null;
  const scannedAmt = scanned.effectiveAmount;
  const totalAmt = scanned.totalPaidAmount;

  const amountMatches =
    entryAmt !== null && scannedAmt !== null && Math.abs(entryAmt - scannedAmt) < 0.5;

  const entryDate = (entry.date ?? "").trim();
  const dateMatches = Boolean(
    entryDate && scanned.paymentDate && entryDate === scanned.paymentDate,
  );

  const entryTime = (entry.time ?? "").trim().toLowerCase();
  const scannedTime = (scanned.paymentTime ?? "").trim().toLowerCase();
  const normTime = (t: string) => t.replace(/:\d{2}\s*(am|pm)/i, " $1").trim();
  const timeMatches = Boolean(
    !scannedTime || !entryTime || normTime(entryTime) === normTime(scannedTime),
  );

  const cleanEntryLoan = (entry.loanId ?? "").replace(/^['`\u2018\u2019]+/, "").trim();
  const loanIdMatches =
    scanned.loanId && cleanEntryLoan
      ? scanned.loanId.toLowerCase() === cleanEntryLoan.toLowerCase()
      : null;

  const overallMatch =
    statusOk && amountMatches && dateMatches && (loanIdMatches === null || loanIdMatches === true);

  const appLabel = scanned.paymentApp ?? "UPI/BBPS";
  const notes: string[] = [];

  if (!statusOk) {
    notes.push(`Payment Status is ${scanned.transactionStatus} (Not Confirmed)`);
  }
  if (loanIdMatches === false) {
    notes.push(
      `Wrong Receipt Attached: Receipt Loan ID is ${scanned.loanId}, Sheet has ${cleanEntryLoan}`,
    );
  }
  if (!amountMatches && scannedAmt !== null) {
    if (scanned.convenienceFee && totalAmt && entryAmt === totalAmt) {
      notes.push(
        `${appLabel} रसीद में कुल ₹${totalAmt} में ₹${scanned.convenienceFee} सुविधा शुल्क हटाकर मूल बिल राशि ₹${scannedAmt} है`,
      );
    } else {
      notes.push(
        `${appLabel} रसीद के अनुसार वास्तविक भुगतान राशि ₹${scannedAmt} है (दर्ज: ₹${entryAmt ?? "—"})`,
      );
    }
  }
  if (!dateMatches && scanned.paymentDate) {
    notes.push(
      `${appLabel} रसीद के अनुसार भुगतान ${scanned.paymentDate}${scanned.paymentTime ? ` (${scanned.paymentTime})` : ""} को हुआ था`,
    );
  }

  const amansRemarkText = overallMatch
    ? `Verified: Amount & Date matched (${appLabel}${scanned.utrNumber ? ` UTR ${scanned.utrNumber}` : ""})`
    : notes.length > 0
      ? notes.join(" | ")
      : `OCR Checked: ${scanned.verificationSummary}`;

  return {
    statusOk,
    amountMatches,
    dateMatches,
    timeMatches,
    loanIdMatches,
    overallMatch,
    suggestedAmount: scannedAmt,
    suggestedDate: scanned.paymentDate,
    suggestedTime: scanned.paymentTime,
    suggestedLoanId: scanned.loanId,
    amansRemarkText,
    hindiDiscrepancyNote: notes.join("। "),
  };
}

/**
 * Normalizes an image in the browser using an HTML5 Canvas without inverting colors
 * or distorting contrast (Tesseract's internal Leptonica Otsu binarizer handles mixed light/dark sections natively).
 * This also heals truncated JPEGs by re-encoding them as valid PNGs.
 */
async function normalizeImageInBrowser(
  source: File | Blob | string,
): Promise<string | File | Blob> {
  if (typeof document === "undefined") return source;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    let objectUrl: string | null = null;
    if (typeof source !== "string") {
      objectUrl = URL.createObjectURL(source);
      img.src = objectUrl;
    } else {
      img.src = source;
    }

    img.onload = () => {
      try {
        const scale = img.width < 800 ? 1.5 : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          resolve(source);
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const pngDataUrl = canvas.toDataURL("image/png");
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(pngDataUrl);
      } catch {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(source);
      }
    };

    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(source);
    };
  });
}

/**
 * Runs 100% free open-source Tesseract.js OCR in the browser (or Node) on a File, Blob, or Data URL.
 */
export async function scanReceiptOcr(
  source: File | Blob | string,
  onProgress?: (pct: number) => void,
): Promise<ParsedReceiptResult> {
  const Tesseract = await import("tesseract.js");
  const preparedSource = await normalizeImageInBrowser(source);

  const result = await Tesseract.recognize(preparedSource, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && typeof m.progress === "number" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  const rawText = result.data?.text ?? "";
  const confidence = Math.round(result.data?.confidence ?? 85);

  return parseReceiptText(rawText, confidence);
}

function extractDriveId(url: string): string | null {
  if (!url) return null;
  const match = /(?:[?&]id=|\/file\/d\/|\/d\/)([a-zA-Z0-9_-]{15,50})/.exec(url);
  if (match) return match[1]!;
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(url.trim())) return url.trim();
  return null;
}

export async function downloadDriveImageBuffer(
  receiptUrl: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (receiptUrl.startsWith("data:image/")) {
    const commaIdx = receiptUrl.indexOf(",");
    const meta = receiptUrl.slice(5, commaIdx);
    const mimeType = meta.split(";")[0] || "image/jpeg";
    const base64 = receiptUrl.slice(commaIdx + 1);
    return { buffer: Buffer.from(base64, "base64"), mimeType };
  }

  const fileId = extractDriveId(receiptUrl);
  if (!fileId) {
    // Only Google Drive receipt images (or inline data URIs) may be fetched.
    // Arbitrary URLs would let the server be pointed at any website.
    throw new Error(
      "Receipt images must be Google Drive links. Only Drive-hosted receipts can be scanned.",
    );
  }
  const candidateUrls = [
    `https://lh3.googleusercontent.com/d/${fileId}=s1600`,
    `https://lh3.googleusercontent.com/d/${fileId}=w1200-rj`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
    `https://drive.google.com/uc?export=download&id=${fileId}`,
  ];

  let lastError = "Could not download receipt image from Google Drive";
  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        redirect: "follow",
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${url}`;
        continue;
      }
      const contentType = res.headers.get("content-type") || "image/jpeg";
      if (contentType.includes("text/html")) {
        lastError =
          "Google Drive returned an HTML page instead of an image (check file sharing permissions)";
        continue;
      }
      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength < 200) {
        continue;
      }
      return {
        buffer: Buffer.from(arrayBuf),
        mimeType: contentType.split(";")[0] || "image/jpeg",
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError);
}

/**
 * Attempts zero-cost built-in Vision extraction if GEMINI_API_KEY is provided by the runtime environment,
 * and falls back to local open-source Tesseract.js + deterministic Indian UPI/BBPS parser.
 */
export async function analyzeReceiptBufferServer(
  buffer: Buffer,
  mimeType: string,
): Promise<ParsedReceiptResult> {
  const freeEnvKey =
    typeof process !== "undefined"
      ? process.env?.GEMINI_API_KEY || process.env?.GOOGLE_API_KEY
      : undefined;

  if (freeEnvKey) {
    try {
      const base64 = buffer.toString("base64");
      const prompt = `Analyze this Indian loan collection payment receipt screenshot (PhonePe, Google Pay, Paytm, Navi, BBPS, Cash Drop, or IDFC FIRST Bank) in English, Hindi, or regional script.
Return ONLY a valid JSON object with these exact keys:
{
  "isReceipt": boolean,
  "transactionStatus": "SUCCESS" | "PENDING" | "FAILED" | "UNKNOWN",
  "billAmount": number | null,
  "totalPaidAmount": number | null,
  "convenienceFee": number | null,
  "paymentDate": "YYYY-MM-DD" | null,
  "paymentTime": "hh:mm am/pm" | null,
  "loanId": string | null,
  "utrNumber": string | null,
  "paymentApp": string | null,
  "extractedText": string
}
Rules:
1. Separate convenience/platform fee from Total Paid! Example: if Total Amount is ₹3,299 and Platform Fee is ₹3 (or Bill Amount is ₹3,296), then billAmount MUST be 3296, totalPaidAmount MUST be 3299, and convenienceFee MUST be 3.
2. Do NOT confuse "EMI OverDue Amount" or scheduled "Emi Amount" with the actual amount paid by the customer if they paid a different "Bill Amount" (e.g. if Emi Amount is 2926.00 but Bill Amount paid is 3,000 and Total Amount is 3,003, billAmount is 3000).
3. Ignore promotional banners like "Watch 2000+ Shows Daily" or "up to 10,000".
4. Extract the actual payment date (in YYYY-MM-DD) and time (in 12-hour hh:mm am/pm format). If the header date is in Hindi or cut off, check the PhonePe/BBPS Transaction ID (e.g. NB2610021131... means 2026-10-02 at 11:31 am).
5. Extract the Loan Account Number / Loan ID (typically 8-10 digits like 184773074, often before .retail@idfcbank or next to Loan No).`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${freeEnvKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: mimeType || "image/jpeg",
                      data: base64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: "application/json",
            },
          }),
        },
      );

      if (res.ok) {
        const json = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const textPart = json.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
        if (textPart) {
          const parsedJson = JSON.parse(textPart) as {
            isReceipt?: boolean;
            transactionStatus?: TransactionStatus;
            billAmount?: number | null;
            totalPaidAmount?: number | null;
            convenienceFee?: number | null;
            paymentDate?: string | null;
            paymentTime?: string | null;
            loanId?: string | null;
            utrNumber?: string | null;
            paymentApp?: string | null;
            extractedText?: string;
          };

          const billAmt =
            typeof parsedJson.billAmount === "number" && parsedJson.billAmount > 0
              ? parsedJson.billAmount
              : null;
          const totalAmt =
            typeof parsedJson.totalPaidAmount === "number" && parsedJson.totalPaidAmount > 0
              ? parsedJson.totalPaidAmount
              : null;
          const feeAmt =
            typeof parsedJson.convenienceFee === "number" && parsedJson.convenienceFee > 0
              ? parsedJson.convenienceFee
              : null;

          const effectiveAmount =
            billAmt ?? (totalAmt && feeAmt && totalAmt > feeAmt ? totalAmt - feeAmt : totalAmt);

          const normDate = parsedJson.paymentDate
            ? normalizeSheetDate(parsedJson.paymentDate)
            : null;
          const normTime = parsedJson.paymentTime
            ? normalizeSheetTime(parsedJson.paymentTime)
            : null;
          const status: TransactionStatus = parsedJson.transactionStatus || "SUCCESS";

          const parts: string[] = [];
          if (parsedJson.paymentApp) parts.push(parsedJson.paymentApp);
          parts.push(`Status: ${status}`);
          if (effectiveAmount !== null) {
            if (feeAmt && totalAmt && totalAmt !== effectiveAmount) {
              parts.push(`Bill ₹${effectiveAmount} (Total ₹${totalAmt} - ₹${feeAmt} fee)`);
            } else {
              parts.push(`Amount: ₹${effectiveAmount}`);
            }
          }
          if (normDate) parts.push(`Date: ${normDate}${normTime ? ` ${normTime}` : ""}`);
          if (parsedJson.loanId) parts.push(`Loan ID: ${parsedJson.loanId}`);
          if (parsedJson.utrNumber) parts.push(`UTR: ${parsedJson.utrNumber}`);

          return {
            isReceipt: parsedJson.isReceipt ?? true,
            transactionStatus: status,
            billAmount: effectiveAmount,
            totalPaidAmount: totalAmt ?? effectiveAmount,
            convenienceFee: feeAmt,
            effectiveAmount,
            paymentDate: normDate,
            paymentTime: normTime,
            loanId: parsedJson.loanId ? String(parsedJson.loanId).trim() : null,
            utrNumber: parsedJson.utrNumber ? String(parsedJson.utrNumber).trim() : null,
            paymentApp: parsedJson.paymentApp ?? null,
            rawText: parsedJson.extractedText || parts.join("\n"),
            confidence: 98,
            verificationSummary: parts.join(" | "),
          };
        }
      } else {
        const errBody = await res.text().catch(() => "");
        console.warn(`Vision API error (${res.status} ${res.statusText}):`, errBody);
      }
    } catch (err) {
      console.warn("Vision fallback to local Tesseract OCR:", err);
    }
  }

  const tesseractMod = await import("tesseract.js");
  const tesseractObj =
    (tesseractMod as { default?: { recognize?: typeof tesseractMod.recognize } }).default ||
    tesseractMod;
  const recognize = tesseractObj.recognize || tesseractMod.recognize;
  const result = await recognize(buffer, "eng");
  const rawText = result.data?.text ?? "";
  const confidence = Math.round(result.data?.confidence ?? 85);

  return parseReceiptText(rawText, confidence);
}

export async function scanExistingReceiptPlain(input: {
  row?: number;
  receiptUrl?: string;
  writeToAmansRemarks?: boolean;
  autoFixSheetRow?: boolean;
}) {
  const { readCollections } = await import("./mahavtaar.functions");
  const { sheetsUpdate, invalidateSheetsCache } = await import("./mahavtaar.server");

  let targetRowObj = undefined;
  if (input.row) {
    const all = await readCollections();
    targetRowObj = all.find((r) => r.row === input.row);
  }

  const urlToScan = input.receiptUrl || targetRowObj?.receiptLinks?.[0];
  if (!urlToScan) {
    throw new Error("No receipt URL found for this row.");
  }

  const { buffer, mimeType } = await downloadDriveImageBuffer(urlToScan);
  const parsed = await analyzeReceiptBufferServer(buffer, mimeType);
  const comparison = compareReceiptWithEntry(parsed, {
    amount: targetRowObj?.amount ?? null,
    date: targetRowObj?.date ?? null,
    time: targetRowObj?.time ?? null,
    loanId: targetRowObj?.loanId ?? null,
  });

  const rowNum = input.row ?? targetRowObj?.row;
  let updatedSheet = false;

  if (rowNum && (input.writeToAmansRemarks || input.autoFixSheetRow)) {
    if (input.autoFixSheetRow) {
      const newAmt = comparison.suggestedAmount ?? targetRowObj?.amount;
      const newDate = comparison.suggestedDate ?? targetRowObj?.date;
      const newTime = comparison.suggestedTime || targetRowObj?.time || "";
      if (newAmt && newDate) {
        await sheetsUpdate(`Collections!C${rowNum}:E${rowNum}`, [[newAmt, newDate, newTime]]);
      }
    }
    await sheetsUpdate(`Collections!S${rowNum}`, [[comparison.amansRemarkText]]);
    invalidateSheetsCache();
    updatedSheet = true;
  }

  return {
    row: rowNum ?? null,
    receiptUrl: urlToScan,
    parsed,
    comparison,
    updatedSheet,
  };
}
