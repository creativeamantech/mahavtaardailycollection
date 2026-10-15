# Implementation Plan: Comprehensive Read & Write MCP Access

Give the Model Context Protocol (MCP) server full read and write capabilities across all Mahavtaar Daily Collection modules (Payments, ECS/Special, Conflicts, App Settings, and Notifications), appending and updating directly to the respective Google Sheets tabs with open access.

---

## Proposed Changes & New MCP Tools

### 1. Payment Collections Write & Read Tools
Add modular MCP tools under `src/lib/mcp/tools/`:
- **`record-payment.ts` (`record_payment`)**:
  - Allows AI assistants to record a daily collection entry (Executive, Loan ID, Amount, Payment Date, Entry Date, Time, Entry Type, Settlement, Remarks, and Receipt URLs).
  - Appends to the month's Google Sheet tab with formatting and conflict detection check.
- **`update-payment.ts` (`update_payment`)**:
  - Updates an existing collection entry by Loan ID, date, or index in Google Sheets.
- **`delete-payment.ts` (`delete_payment`)**:
  - Removes a collection entry from Google Sheets when duplicates or erroneous records are identified.

### 2. ECS & Special Collections Tools
- **`list-ecs.ts` (`list_ecs_entries`)**:
  - Lists ECS and Special collection entries, filtered by status, executive, or date range.
- **`record-ecs.ts` (`record_ecs_entry`)**:
  - Creates a new ECS or Special transaction in the `ECS_Special_Info` tab.
- **`update-ecs.ts` (`update_ecs_entry`)**:
  - Updates the status (`Confirmed`, `Bounced`, `Cancelled`, `Cleared`) and remark for an ECS record.

### 3. Conflict Resolution Tools
- **`list-conflicts.ts` (`list_conflicts`)**:
  - Returns duplicate payment records grouped side-by-side with receipt links and validity status to compare potential conflicts.
- **`resolve-conflict.ts` (`resolve_conflict`)**:
  - Allows marking a suspected duplicate as valid (`Not Conflicted`), reverting validation, or deleting the conflicting duplicate.

### 4. App Settings & Feature Flags Tools
- **`get-settings.ts` (`get_settings`)**:
  - Reads active feature flags, default allocation category, and system configurations.
- **`update-settings.ts` (`update_settings`)**:
  - Updates feature flags (Payment Entry, Report, Loans, Conflicts, ECS, Notifications, etc.) and the default allocation category in `AppSettings`.

### 5. Notifications Management Tools
- **`add-notification.ts` (`add_notification`)**:
  - Appends an announcement notification to the `Notifications` tab in Google Sheets.
- **`remove-notification.ts` (`remove_notification`)**:
  - Marks an active notification as removed in the sheet.

### 6. MCP Server Configuration & Data Bridge
- **`src/lib/mcp/data.ts`**:
  - Export reusable data bridge helpers for both reading and writing to Google Sheets tabs (`mahavtaar.server.ts` integration).
- **`src/lib/mcp/index.ts`**:
  - Register all newly added write tools.
  - Set instructions reflecting full read and write capabilities across all app domains with open access (no authentication required).
  - Annotate state-modifying tools with `readOnlyHint: false`.

---

## Verification Plan

### Automated Build & Lint Verification
1. Run `lint_applet` to verify TypeScript typings and ESLint rules across all new tool files.
2. Run `compile_applet` to ensure TanStack Start & Vite bundle the MCP handlers and tools without errors.

### Functional Verification
1. **MCP Endpoint Discovery**:
   - Query `GET /mcp` or tool schemas to ensure all 11+ tools (both read and write) are published with accurate Zod schemas.
2. **Payment Collection Write**:
   - Test recording a payment entry via the MCP tool interface and verify sheet append logic.
3. **ECS Entry Write**:
   - Test creating and updating an ECS entry in `ECS_Special_Info`.
4. **Conflict Resolution**:
   - Test listing conflicts and marking entries as valid via MCP.
5. **Settings & Notification Write**:
   - Verify toggling a feature flag and adding a notification through MCP.
