# Implementation Plan: 100% Free Open-Source Receipt OCR & Verification System (Zero API / Zero Cost)

Implement a completely free, self-contained **Receipt OCR & Verification System** using open-source **`tesseract.js`** (WebAssembly + Node.js) combined with a specialized **Indian UPI & BBPS Receipt Parser**. This requires **zero paid APIs, zero API keys, and zero external billing**, running locally in the browser for live uploads and on the server for existing Google Sheet rows.

---

## 1. 100% Free OCR Engine & Rule-Based Receipt Parser

### A. Open-Source OCR Package

- Install **`tesseract.js`** (100% free, MIT/Apache open-source OCR engine that runs in browser WebAssembly and Node.js without any external API keys or usage limits).

### B. Deterministic Indian UPI & BBPS Receipt Parser (`src/lib/receipt-ocr.ts`)

- Pre-process receipt screenshots (contrast normalization & grayscale scaling) for crisp text extraction across dark-mode and light-mode screenshots.
- Built-in rule-based parser specifically tuned for **PhonePe, Google Pay, Paytm, Navi, BBPS, and IDFC FIRST Bank** receipts:
  - **Payment Status (`transactionStatus`)**: Detects `"SUCCESS"` (`Transaction Successful`, `Payment Successful`, `Paid`, `Completed`, `Bill Paid`), `"PENDING"` (`Processing`, `Pending`), or `"FAILED"` (`Failed`, `Declined`, `Rejected`).
  - **Smart Bill Amount vs. Convenience Fee (`billAmount`, `totalPaidAmount`, `convenienceFee`)**:
    - Parses itemized breakdowns on PhonePe/BBPS receipts (e.g., if Total Paid is `₹6,748` and Convenience Fee is `₹3`, extracts `billAmount = 6745` and `totalPaidAmount = 6748`).
    - Handles OCR quirks where the `₹` symbol is read as `Rs`, `INR`, `7`, or `2` before formatted numbers.
  - **Date & Time Extraction (`paymentDate`, `paymentTime`)**:
    - Parses all Indian receipt date/time formats (`18 Oct 2026, 02:15 PM`, `08-10-2026 at 12:45 pm`, `18/10/2026`, `Oct 10, 2026`) into normalized `YYYY-MM-DD` and `hh:mm AM/PM`.
  - **Loan ID & UTR Extraction (`loanId`, `utrNumber`, `paymentApp`)**:
    - Extracts Loan Account Numbers (e.g. `183627736`), 12-digit UPI UTR / Reference IDs, and identifies the payment app (`PhonePe`, `Google Pay`, `Paytm`, `Navi`, `BBPS`, `IDFC FIRST Bank`).

---

## 2. Live Upload Scanning & Auto-Fill (`src/routes/_authenticated/index.tsx`)

- **Instant Browser OCR on File Selection**:
  - As soon as a receipt image is chosen or dropped on the Payment Entry form, run the free `tesseract.js` scanner directly in the browser with a progress indicator.
- **Auto-Fill & Smart Date Classification**:
  - Automatically fills empty form fields (`Amount`, `Loan ID`, `Time`, `Date`).
  - If the receipt's `paymentDate` is earlier than today (`todayISO()`), automatically switches Entry Type to **"Previous Paid File"** and sets the Original Payment Date to the receipt date.
- **Live Match Status Panel**:
  - Shows a clean comparison table (`tabular-nums` monospace figures, 1px hairline borders) comparing **Scanned Receipt** vs **Entered Form Values**:
    - **Payment Status**: Confirmed Paid (`SUCCESS`) vs `FAILED / PENDING` warning.
    - **Amount Match**: Exact Match vs Mismatch (with a 1-click **"Apply ₹X from Receipt"** button, showing convenience fee details if detected).
    - **Date & Time Match**: Exact Match vs Mismatch (with a 1-click **"Apply Receipt Date/Time"** button).
    - **Loan ID Check**: Confirms if the Loan ID on the receipt matches the entered Loan ID.
- **Automatic Sheet Audit Trail**:
  - When saving the entry to Google Sheets (`saveCollection`), automatically writes the OCR verification summary into **Aman's Remarks (Column S)** so verified entries are marked immediately.

---

## 3. Existing Sheet Rows OCR Audit & Server Proxy (`src/lib/receipt-ocr.functions.ts`, `conflicts.tsx`, `report.tsx`)

- **Google Drive Image Fetch Helper**:
  - Create a lightweight server function (`fetchDriveReceiptImage`) that downloads the receipt image from Google Drive (`https://drive.google.com/uc?export=download&id={fileId}` or `https://lh3.googleusercontent.com/d/{fileId}=w1200`) and returns base64 data or runs `tesseract.js` server-side—avoiding browser CORS restrictions while staying 100% free.
- **1-Click "Scan Receipt (Free OCR)" on Existing Rows**:
  - In **Conflicts** (`src/routes/_authenticated/conflicts.tsx`) and **Reports** (`src/routes/_authenticated/report.tsx`), add a **"Scan Receipt (OCR)"** button on rows with attached receipts.
  - Compares the scanned receipt against the Google Sheet row (`Amount`, `Payment Date`, `Time`, `Loan ID`) and provides 1-click buttons to:
    1. **Write Verification to Aman's Remarks (Column S)**.
    2. **Auto-Correct Sheet Amount / Date & Log in Aman's Remarks**.
- **MCP Tool (`src/lib/mcp/tools/scan-receipt-ocr.ts`)**:
  - Expose `scan_receipt_ocr` on `/mcp` using the same free `tesseract.js` engine so MCP clients can scan any row's receipt for free.

---

## 4. Verification Plan

1. **Lint & TypeScript**: Run `lint_applet` to verify zero errors.
2. **Build Verification**: Run `compile_applet` to ensure clean client and server builds.
3. **End-to-End Test**:
   - Test scanning a real Google Drive receipt from the existing `Collections` sheet using the free OCR engine and verify extracted Amount, Date, Time, and Loan ID.
