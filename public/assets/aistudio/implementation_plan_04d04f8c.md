# Paid File Upload to Master Data Implementation Plan

An end-to-end reconciliation and ingestion workflow that parses uploaded Paid File spreadsheets, auto-maps columns interactively, protects Manual and Corrected Master Data values while flagging conflicts, and commits verified updates atomically with full Audit Log and P2P Sync coverage.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> All core workflow decisions below were confirmed during requirements alignment and govern the architecture of the Paid File ingestion pipeline.

- **Confirmed Decision 1 — Interactive Column Mapping**: Uploaded spreadsheets (`.xlsx`, `.xls`, `.csv`) undergo header auto-detection and present an interactive column mapping preview before data is merged, allowing administrators to adjust mappings (e.g., Agreement ID, SFDC, Online, Direct DAC, ECS, Special) or verify sample parsed rows.
- **Confirmed Decision 2 — Protected Overrides & Conflict Flagging**: Master Data records previously edited manually or marked as Corrected are never silently overwritten by a Paid File upload; instead, discrepancies against protected records or provisional collections are flagged as conflicts for explicit review.
- **Confirmed Decision 3 — Duplicate & Unmatched Row Handling**: Duplicate Loan IDs within the uploaded Paid File resolve using last-occurrence-wins semantics, and rows whose Agreement ID does not exist in Master Data are skipped cleanly with exact skip counts surfaced in the review summary.
- **Confirmed Decision 4 — Pre-Merge Review Modal with Audit & Sync**: No Master Data mutation occurs on file drop; users inspect a structured Pre-Merge Reconciliation Modal showing matched updates, protected skips, unmatched counts, and conflicts, and upon confirmation commit changes atomically to IndexedDB, the cryptographic Audit Log, and the P2P Sync Journal.

---

### 1. Overview & Core Concept

- **What It Does**: Replaces blind one-click Paid File overwriting with a guided, transparent four-stage pipeline (`Upload` → `Column Mapping` → `Reconciliation Review` → `Atomic Master Commit`). Incoming payment columns (`SFDC + Online` or `DAC`, `ECS`, `Special`) are matched against the existing Master Data portfolio, computed against current payment sources and provisional entries, and applied safely to Master Data so every downstream dashboard, Data Explorer table, and Pivot report reflects accurate recovery status immediately.
- **Target Audience / Persona**: Operations Managers, Portfolio Admins, and MIS Analysts responsible for ingesting daily or monthly payment confirmation files into the master loan collection ledger.
- **Key Value**: Eliminates silent data loss on manually corrected accounts, prevents broken imports when upstream bank/partner column headers vary, and guarantees every Paid File merge is traceable across the Audit Log and synchronized across connected P2P peers.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Upload Trigger**: On the Data Entry workflow stepper, the user selects or drops a `.xlsx`, `.xls`, or `.csv` file into the Paid File step. If Master Data has not been loaded yet, a clear prerequisite guard explains that a Main Data upload is required before merging Paid records.
  2. **Interactive Column Mapping Preview**: Upon parsing the workbook headers and first few sample rows, a structured mapping panel opens inside the modal:
     - Displays auto-detected column assignments for **Agreement ID** (required), **DAC Components** (`SFDC` + `Online` or single `DAC` / `Paid Amount`), **ECS**, and **Special**.
     - Allows one-click reassignment via clean dropdown selectors if a partner export uses non-standard header names, with an instant live preview of the first 5 parsed records showing computed `DAC`, `ECS`, and `Special` totals.
     - Validates that at least the Agreement ID and one collection amount column are mapped before enabling progression to Reconciliation Review.
  3. **Pre-Merge Reconciliation Review**: Clicking **Analyze Against Master Data** evaluates the deduplicated Paid File rows against the current Master Data store and presents:
     - A crisp four-metric reconciliation strip: **Matched Updates**, **Protected (Manual / Corrected)**, **Conflicts Flagged**, and **Skipped (Unmatched IDs)**.
     - Segmented filter tabs (`All Changes`, `Clean Updates`, `Conflicts Flagged`, `Protected Skips`) above a compact, high-density diff table showing Agreement ID, Customer Name, Existing vs. Incoming `DAC / ECS / Special`, current Source tag, and Resulting Action.
  4. **Atomic Commit & Completion Feedback**: Clicking **Commit to Master Data** writes only the delta-changed records inside an atomic transaction, records the upload session, appends tamper-evident Audit Log entries, queues Sync Journal events, refreshes Master Data across all views, and presents a concise completion toast with a shortcut to inspect conflicts in Data Explorer or Data Entry if any were flagged.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: High-density institutional financial ledger aligned with the existing application design system—flat single-elevation surfaces, crisp hairline borders, zero nested-card clutter, and clean unboxed metadata separated by typographic delimiters (`·`).
  - *Color Palette & Mood*: Uses semantic CSS theme tokens (`--background`, `--card`, `--border`, `--primary`, `--muted-foreground`) supporting both Light and Dark themes seamlessly. Semantic accents are reserved strictly for data state paired with explicit text labels: `--success` for clean paid updates, `--warning` for protected manual/corrected skips, and `--destructive` for newly flagged payment conflicts.
  - *Typography & Hierarchy*: `Plus Jakarta Sans` for modal titles, section headers, and controls (`text-wrap: balance` on headers), paired strictly with `JetBrains Mono` and `tabular-nums` on all Agreement IDs, currency amounts, row counts, and before/after diffs so columns align vertically.
  - *Component Styling & Layout*: Full desktop dialog width (`max-w-4xl`) with single-elevation structural panels, compact `36px–40px` diff table rows, right-aligned numeric columns, and single-line action buttons (`whitespace-nowrap shrink-0`).
- **Interactive Feedback & Motion**:
  - Immediate parsing spinner while reading large workbooks in memory, settling smoothly (`<= 200ms`) into the Column Mapping step.
  - Clear validation errors for empty sheets, missing required mappings, or malformed numeric cells without losing user-selected mappings.
  - Empty states inside filtered preview tabs (e.g., `"No conflicts detected in this upload"`) and a disabled commit guard if zero valid Master Data updates exist.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Client-Side Header Auto-Detection + Interactive Mapping**
  - *Chosen Approach*: Inspect workbook headers on upload, score/match common aliases (`AGREEMENTID`, `Loan ID`, `SFDC`, `Online`, `DAC`, `ECS`, `Special Pres`, `Special`), and let the user review or adjust mappings before merging.
  - *Why*: Partner and bank paid files frequently rename columns (e.g., `Loan No` vs `AGREEMENTID`, or a combined `Paid DAC` column instead of separate `SFDC` + `Online` columns). Interactive mapping prevents silent zero-value merges.
  - *Alternatives Considered*: Hardcoding fixed column names fails silently on minor header changes; building a full ETL rule builder adds unnecessary complexity for routine daily uploads.

- **Decision 2: Strict Protection of Manual & Corrected Records + Conflict Flagging**
  - *Chosen Approach*: When a matching Master Data record has `dac_source === 'MANUAL'` or `dac_source === 'CORRECTED'` (or `is_corrected === true`), Paid File values do not overwrite the protected confirmed figures. If the incoming Paid File amount differs from the protected value, the record is flagged (`is_conflict = true`) with incoming values preserved for inspection rather than silently clobbered. Similarly, if an unconfirmed `provisional_dac` exists, exact matches confirm and clear provisional, while mismatches raise `is_conflict = true`.
  - *Why*: Field managers and admins perform manual overrides and Corrected DAC uploads specifically to fix upstream feed errors; a subsequent Paid File must never undo verified human corrections.
  - *Alternatives Considered*: Unconditional overwrite risks reverting audited corrections; silently ignoring mismatches hides real reconciliation discrepancies between bank feeds and field corrections.

- **Decision 3: Last-Duplicate-Wins & Skip Unmatched Rows**
  - *Chosen Approach*: While building the lookup index from mapped Paid File rows, duplicate Agreement IDs overwrite earlier entries in the staging map (last row wins). Rows whose Agreement ID is not present in Master Data are excluded from database writes and counted in the `Skipped (Unmatched)` summary.
  - *Why*: Paid File exports often append chronological updates where the latest row represents final settlement status, and Master Data represents the authorized monthly allocation base so out-of-portfolio rows should not pollute Master Data.
  - *Alternatives Considered*: Auto-inserting unmatched rows would create orphan loan records missing `POS`, `EMI`, `Bucket`, and `Executive` metadata; summing duplicate rows could double-count re-exported entries.

- **Decision 4: Delta-Only Atomic Commit with Audit Log & Sync Journal Integration**
  - *Chosen Approach*: Instead of rewriting the entire Master Data collection on every Paid File upload, compute the exact set of modified loan records and commit them inside a single IndexedDB transaction alongside the `UploadSession` record, structured `AuditEntry` diff records (with SHA-256 hash chaining), and `SyncJournalRecord` update events.
  - *Why*: Preserves performance on large portfolios (10,000+ rows), keeps Audit Log entries accurate per changed field/record, and ensures P2P sync peers receive incremental Paid File updates automatically instead of drifting out of sync.
  - *Alternatives Considered*: Bulk-putting the entire dataset skips per-record diff tracking and leaves P2P peers unaware of Paid File updates.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                        DATA ENTRY WORKFLOW STEPPER                           │
│   [1. Main Data] ──▶ [2. Paid File Dropzone] ──▶ [3. Additional] ──▶ [4. Corr]│
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │ File Buffer (.xlsx / .xls / .csv)
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     WORKBOOK INSPECTOR & AUTO-MAPPER                         │
│  • Extract Sheet Headers + Sample Rows                                       │
│  • Auto-match Aliases (Agreement ID, SFDC, Online, DAC, ECS, Special)        │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │ Headers + Suggested Map
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                 PAID FILE PREVIEW & RECONCILIATION MODAL                     │
│  ┌────────────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │ Step A: Interactive Column Mapping │─▶│ Step B: Pre-Merge Diff Review   │ │
│  │ • Dropdown Overrides               │  │ • Matched / Protected /Skipped  │ │
│  │ • Live 5-Row Computation Preview   │  │ • Conflict Flags & Diff Table   │ │
│  └────────────────────────────────────┘  └────────────────┬────────────────┘ │
└───────────────────────────────────────────────────────────┼──────────────────┘
                                                            │ User Confirms Commit
                                                            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                ATOMIC MASTER DATA REPOSITORY TRANSACTION                     │
│  ┌─────────────────────┐  ┌──────────────────────┐  ┌─────────────────────┐  │
│  │ Master Loan Store   │  │ Cryptographic Audit  │  │ P2P Sync Journal    │  │
│  │ (Delta Bulk Put +   │  │ Log (SHA-256 Chained │  │ (Lamport Clocked    │  │
│  │  Upload Session)    │  │  Field/Batch Diffs)  │  │  UPDATE Events)     │  │
│  └──────────┬──────────┘  └──────────────────────┘  └─────────────────────┘  │
└─────────────┼────────────────────────────────────────────────────────────────┘
              │ Reactive Context State Refresh
              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         DOWNSTREAM MASTER DATA VIEWS                         │
│  [Data Entry Table] · [Data Explorer] · [Financial Engine] · [City/Team Pivots]
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - **Column Mapping Configuration**: Stores selected header keys for `agreementIdCol` (required), `dacMode` (`split_sfdc_online` or `single_dac`), `sfdcCol`, `onlineCol`, `dacCol`, `ecsCol`, and `specialCol`, alongside validation state.
  - **Staged Paid Row**: Normalized row output after applying the active mapping and last-duplicate-wins deduplication (`agreementid`, `dac`, `ecs`, `special`, plus row index metadata for traceability).
  - **Reconciliation Plan**: Categorized diff output computed against current Master Data records:
    - `updates`: Records eligible for Master Data update with before/after snapshots (`dac`, `ecs`, `special`, `dac_source: 'PAID_FILE'`, `ecs_source: 'PAID_FILE'`, `special_source: 'PAID_FILE'`, updated `provisional_dac` and `is_conflict`).
    - `protectedConflicts`: Master records locked by `MANUAL` or `CORRECTED` source where incoming Paid values differ—preserved without overwriting `dac`/`ecs`/`special`, while flagging `is_conflict: true` and recording incoming conflict metadata for resolution.
    - `protectedMatches`: Master records locked by `MANUAL` or `CORRECTED` source whose values already match the Paid File—no overwrite needed.
    - `unmatchedCount` & `duplicateCount`: Metrics surfaced in the review header so the operator has 100% row accountability (`Total Parsed Rows = Matched + Protected + Duplicates Replaced + Skipped Unmatched`).
  - **Domain Type Alignment**: Expand `dac_source` (and optional `ecs_source`, `special_source`, `paid_conflict_dac`, `last_paid_upload_at`) in the shared domain definitions so TypeScript types across parsing, repository persistence, UI badges, and financial calculations remain strictly consistent.

- **Interactive Component & State Mapping**:
  - **Upload Dropzone Handler**: Reads selected file into an `ArrayBuffer` without mutating Master Data; extracts sheet headers and sample rows; opens the Paid File Reconciliation Modal in `mapping` step (or displays an actionable error toast if the workbook is empty/unreadable).
  - **Column Mapping Controls**: Updating any column dropdown immediately recomputes the 5-row sample preview (`SFDC + Online` or direct `DAC`, `ECS`, `Special`) and updates mapping readiness. Switching between `SFDC + Online` and `Single DAC Column` adapts visible field selectors cleanly.
  - **Reconciliation Analyzer Trigger**: Deduplicates all parsed rows using last-occurrence-wins, joins against existing Master Data by normalized `agreementid`, enforces `MANUAL` / `CORRECTED` protection and `provisional_dac` cross-checks, and transitions the modal to `review` step.
  - **Review Filter Tabs & Search**: Segmented controls filter the preview diff table between `All Matched`, `Clean Updates`, `Conflicts`, and `Protected Skips`, with instant Agreement ID / Customer search.
  - **Commit Handler**: Executes an atomic IndexedDB transaction updating only affected Master Data records, logging the `PAID_FILE` upload session, appending SHA-256 chained audit entries (preserving field-level traceability without crashing on large batches), and queuing `UPDATE` events to the P2P sync journal; updates React DataContext state and displays a summary toast.
  - **Cancel / Close Handler**: Discards staged buffers cleanly and resets loading indicators so the user can re-upload or adjust files without stale state.

- **Key Sequences & Integrations**:
  - **Financial Calculation Engine Integration**: Master Data updates to `dac`, `ecs`, `special`, and `is_conflict` immediately flow through `calculateRow`, automatically recalculating `total`, `emiCount`, `mainPaid`, `teamPaid`, `rollbackPOS`, and all City/Team Pivot aggregations.
  - **Audit Log & Integrity Verification**: Batch Paid File commits maintain valid `previousHash` → `hash` chaining so the Audit Log cryptographic integrity verifier continues to pass without gaps.
  - **P2P Sync Engine**: Queued `loan_records` updates carry incremented Lamport clocks and field diffs so connected peer devices converge cleanly when online.
