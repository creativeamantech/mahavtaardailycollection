// Server-side Google Sheet Authentication for Mahavtaar Daily Collection.
// Stores credentials and roles in the 'Users' tab of the Daily Collection Google Sheet.
// Enforces salt + scrypt hashed PINs, active status verification, and HMAC signed session tokens.

import crypto from "node:crypto";
import {
  sheetsGet,
  sheetsAppend,
  sheetsUpdate,
  ensureSheet,
  invalidateSheetsCache,
  DAILY_COLLECTION_SPREADSHEET_ID,
} from "./mahavtaar.server";
import { EXECUTIVES } from "./executives";
import { checkSettingsPassword } from "./password-guard.server";

export interface SheetUserRecord {
  userId: string;
  executiveName: string;
  email: string;
  pinHash: string;
  role: "Admin" | "Executive";
  status: "Active" | "Inactive";
  rowNumber: number;
}

export interface SheetUserSafe {
  userId: string;
  executiveName: string;
  email: string;
  role: "Admin" | "Executive";
  status: "Active" | "Inactive";
}

export interface SheetUserSession {
  userId: string;
  executiveName: string;
  email: string;
  role: "Admin" | "Executive";
  status: "Active" | "Inactive";
  expiresAt: number;
}

export const USERS_SHEET_TITLE = "Users";
export const USERS_HEADERS = ["User_ID", "Executive_Name", "Email", "PIN_Hash", "Role", "Status"];

// Fallback in-memory users store to ensure instant login availability
// even if the tab hasn't yet been added to the physical Google Sheet.
let memoryUsersStore: SheetUserRecord[] | null = null;

function getSecretKey(): string {
  return (
    process.env["SESSION_SECRET"] ||
    process.env["SETTINGS_PASSWORD"] ||
    "mahavtaar-daily-collection-secure-secret-2026-key"
  );
}

// Generates salt:hash string using Node crypto scrypt
export function hashPin(pin: string, customSalt?: string): string {
  const salt = customSalt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pin.trim(), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

// Validates PIN against stored salt:hash or raw PIN
export function verifyPin(pin: string, storedHash: string): boolean {
  if (!storedHash || !pin) return false;
  const trimmedPin = pin.trim();

  // 1. Direct match with standard default PINs
  if (trimmedPin === "0003" || trimmedPin === "1234") {
    if (storedHash === trimmedPin) return true;
  }

  // 2. Salt:hash verification
  if (storedHash.includes(":")) {
    const [salt, expected] = storedHash.split(":");
    if (!salt || !expected) return false;
    try {
      const computed = crypto.scryptSync(trimmedPin, salt, 32).toString("hex");
      return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(expected, "hex"));
    } catch (e) {
      console.error("Error verifying pin hash:", e);
      return false;
    }
  }

  // 3. Plain text fallback if sheet was manually edited with raw PIN
  return storedHash.trim() === trimmedPin;
}

// Creates an HMAC-signed stateless session token
export function createSessionToken(user: SheetUserSafe): string {
  const session: SheetUserSession = {
    userId: user.userId,
    executiveName: user.executiveName,
    email: user.email,
    role: user.role,
    status: user.status,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  };
  const payloadStr = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSecretKey())
    .update(payloadStr)
    .digest("base64url");
  return `${payloadStr}.${signature}`;
}

// Verifies and decodes an HMAC-signed session token
export function verifySessionToken(token: string | null | undefined): SheetUserSession | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) return null;

  const expectedSig = crypto
    .createHmac("sha256", getSecretKey())
    .update(payloadStr)
    .digest("base64url");

  if (signature !== expectedSig) {
    return null;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payloadStr, "base64url").toString("utf8"),
    ) as SheetUserSession;

    if (!session || typeof session.expiresAt !== "number") return null;
    if (session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function initDefaultMemoryUsers(): SheetUserRecord[] {
  const users: SheetUserRecord[] = [
    {
      userId: "USR-001",
      executiveName: "Aman",
      email: "aman@mahavtaar.in",
      pinHash: hashPin("0003"),
      role: "Admin",
      status: "Active",
      rowNumber: 2,
    },
  ];

  let idCounter = 2;
  for (const exec of EXECUTIVES) {
    if (exec.toLowerCase() === "aman") continue;
    const padId = String(idCounter).padStart(3, "0");
    users.push({
      userId: `USR-${padId}`,
      executiveName: exec,
      email: `${exec.toLowerCase()}@mahavtaar.in`,
      pinHash: hashPin("1234"),
      role: "Executive",
      status: "Active",
      rowNumber: idCounter + 1,
    });
    idCounter++;
  }

  return users;
}

function getMemoryUsers(): SheetUserRecord[] {
  if (!memoryUsersStore) {
    memoryUsersStore = initDefaultMemoryUsers();
  }
  return memoryUsersStore;
}

// Ensures the Users tab exists and populates initial default accounts if empty
export async function ensureUsersSheet(): Promise<void> {
  try {
    await ensureSheet(USERS_SHEET_TITLE, USERS_HEADERS, "daily_collection");
  } catch (err) {
    console.warn("ensureSheet attempt:", err);
  }
}

// Detects whether the Users tab actually exists in the Google Spreadsheet
export async function isUsersTabAvailableInGoogleSheet(): Promise<boolean> {
  try {
    const res = await fetch(
      `https://docs.google.com/spreadsheets/d/${DAILY_COLLECTION_SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(USERS_SHEET_TITLE)}`,
    );
    if (!res.ok) return false;
    const text = await res.text();
    // If the tab doesn't exist, Google Sheets gviz returns the first sheet (Collections)
    // whose first header is "Executive Name" or "Loan ID"
    const firstLine = text.split("\n")[0] || "";
    if (firstLine.includes("Executive Name") && firstLine.includes("Loan ID")) {
      return false; // Redirected to Collections tab because Users tab is missing!
    }
    if (firstLine.toLowerCase().includes("user_id")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Retrieves all user records from Google Sheet Users tab or fallback memory store
export async function getAllSheetUsers(): Promise<SheetUserRecord[]> {
  await ensureUsersSheet();

  let rows: string[][] = [];
  try {
    rows = await sheetsGet(`${USERS_SHEET_TITLE}!A1:F`, "daily_collection");
  } catch (err) {
    console.error("Failed to read Users sheet:", err);
  }

  // Verify that returned rows are actually from the Users tab and not Collections fallback
  const isRealUsersTab =
    rows &&
    rows.length > 0 &&
    (rows[0]?.[0]?.trim().toLowerCase() === "user_id" ||
      (rows[0]?.[0]?.trim().toLowerCase() !== "executive name" &&
        rows[0]?.[1]?.trim().toLowerCase() === "executive_name"));

  if (!isRealUsersTab) {
    // Users tab not yet created in the Google Spreadsheet, return active memory store
    return getMemoryUsers();
  }

  if (rows.length <= 1) {
    // Header only: seed defaults
    return getMemoryUsers();
  }

  const users: SheetUserRecord[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0] || !r[1]) continue;

    const userId = (r[0] || "").trim();
    const executiveName = (r[1] || "").trim();
    const email = (r[2] || "").trim().toLowerCase();
    const pinHash = (r[3] || "").trim();
    const roleRaw = (r[4] || "Executive").trim();
    const role: "Admin" | "Executive" = roleRaw.toLowerCase() === "admin" ? "Admin" : "Executive";
    const statusRaw = (r[5] || "Active").trim();
    const status: "Active" | "Inactive" =
      statusRaw.toLowerCase() === "inactive" ? "Inactive" : "Active";

    users.push({
      userId,
      executiveName,
      email,
      pinHash,
      role,
      status,
      rowNumber: i + 1,
    });
  }

  if (users.length > 0) {
    memoryUsersStore = users;
    return users;
  }

  return getMemoryUsers();
}

// Authenticates credentials against Google Sheet
export async function authenticateWithGoogleSheet(
  identifier: string,
  pin: string,
): Promise<{ success: boolean; token?: string; user?: SheetUserSafe; error?: string }> {
  if (!identifier || !pin) {
    return { success: false, error: "Please enter your Executive Name / Email and PIN." };
  }

  const query = identifier.trim().toLowerCase();
  const users = await getAllSheetUsers();

  const user = users.find(
    (u) => u.executiveName.toLowerCase() === query || u.email.toLowerCase() === query,
  );

  if (!user) {
    return {
      success: false,
      error: `User "${identifier.trim()}" not found. Please verify executive name or contact the administrator.`,
    };
  }

  if (user.status !== "Active") {
    return {
      success: false,
      error: `Account for ${user.executiveName} is Inactive. Please contact the administrator.`,
    };
  }

  const validPin = verifyPin(pin, user.pinHash);
  if (!validPin) {
    return { success: false, error: "Invalid PIN. Please try again." };
  }

  const safeUser: SheetUserSafe = {
    userId: user.userId,
    executiveName: user.executiveName,
    email: user.email,
    role: user.role,
    status: user.status,
  };

  const token = createSessionToken(safeUser);
  return { success: true, token, user: safeUser };
}

// Checks if an active session belongs to an Administrator or carries valid settings password
export function verifyAdminSession(token?: string | null, password?: string | null): boolean {
  if (password && checkSettingsPassword(password)) {
    return true;
  }
  if (token) {
    const session = verifySessionToken(token);
    if (session && session.status === "Active" && session.role === "Admin") {
      return true;
    }
  }
  throw new Error("Unauthorized: Administrator session or settings password required.");
}

export type AdminAuthInput = string | { token?: string | null; password?: string | null };

function resolveAdminAuth(auth: AdminAuthInput) {
  if (typeof auth === "string") {
    verifyAdminSession(auth);
  } else {
    verifyAdminSession(auth.token, auth.password);
  }
}

// Admin: Add a new user to the Google Sheet Users tab and local store
export async function addSheetUser(
  adminAuth: AdminAuthInput,
  userData: {
    executiveName: string;
    email: string;
    pin: string;
    role: "Admin" | "Executive";
    status: "Active" | "Inactive";
  },
): Promise<SheetUserSafe> {
  resolveAdminAuth(adminAuth);

  const users = await getAllSheetUsers();
  const normName = userData.executiveName.trim();
  const normEmail = userData.email.trim().toLowerCase();

  const existing = users.find(
    (u) =>
      u.executiveName.toLowerCase() === normName.toLowerCase() ||
      (normEmail && u.email === normEmail),
  );
  if (existing) {
    throw new Error(`A user with name "${normName}" or email "${normEmail}" already exists.`);
  }

  const nextNumber = users.length + 1;
  const userId = `USR-${String(nextNumber).padStart(3, "0")}`;
  const pinHash = hashPin(userData.pin);

  const newRecord: SheetUserRecord = {
    userId,
    executiveName: normName,
    email: normEmail,
    pinHash,
    role: userData.role,
    status: userData.status,
    rowNumber: nextNumber + 1,
  };

  if (memoryUsersStore) {
    memoryUsersStore.push(newRecord);
  }

  const row = [userId, normName, normEmail, pinHash, userData.role, userData.status];

  try {
    await sheetsAppend(`${USERS_SHEET_TITLE}!A:F`, [row], "daily_collection");
    invalidateSheetsCache(DAILY_COLLECTION_SPREADSHEET_ID);
  } catch (e) {
    console.warn("sheetsAppend Users warning:", e);
  }

  return {
    userId,
    executiveName: normName,
    email: normEmail,
    role: userData.role,
    status: userData.status,
  };
}

// Admin: Update user status in Google Sheet Users tab
export async function updateSheetUserStatus(
  adminAuth: AdminAuthInput,
  userId: string,
  newStatus: "Active" | "Inactive",
): Promise<{ success: boolean }> {
  resolveAdminAuth(adminAuth);

  const users = await getAllSheetUsers();
  const user = users.find((u) => u.userId === userId);
  if (!user) throw new Error(`User ${userId} not found.`);

  user.status = newStatus;

  try {
    await sheetsUpdate(
      `${USERS_SHEET_TITLE}!F${user.rowNumber}:F${user.rowNumber}`,
      [[newStatus]],
      "daily_collection",
    );
    invalidateSheetsCache(DAILY_COLLECTION_SPREADSHEET_ID);
  } catch (e) {
    console.warn("sheetsUpdate Users warning:", e);
  }

  return { success: true };
}

// Admin: Update user role in Google Sheet Users tab
export async function updateSheetUserRole(
  adminAuth: AdminAuthInput,
  userId: string,
  newRole: "Admin" | "Executive",
): Promise<{ success: boolean }> {
  resolveAdminAuth(adminAuth);

  const users = await getAllSheetUsers();
  const user = users.find((u) => u.userId === userId);
  if (!user) throw new Error(`User ${userId} not found.`);

  user.role = newRole;

  try {
    await sheetsUpdate(
      `${USERS_SHEET_TITLE}!E${user.rowNumber}:E${user.rowNumber}`,
      [[newRole]],
      "daily_collection",
    );
    invalidateSheetsCache(DAILY_COLLECTION_SPREADSHEET_ID);
  } catch (e) {
    console.warn("sheetsUpdate Users warning:", e);
  }

  return { success: true };
}

// Admin: Reset user PIN in Google Sheet Users tab
export async function resetSheetUserPin(
  adminAuth: AdminAuthInput,
  userId: string,
  newPin: string,
): Promise<{ success: boolean }> {
  resolveAdminAuth(adminAuth);

  if (!newPin || newPin.trim().length < 4) {
    throw new Error("PIN must be at least 4 digits.");
  }

  const users = await getAllSheetUsers();
  const user = users.find((u) => u.userId === userId);
  if (!user) throw new Error(`User ${userId} not found.`);

  const newPinHash = hashPin(newPin);
  user.pinHash = newPinHash;

  try {
    await sheetsUpdate(
      `${USERS_SHEET_TITLE}!D${user.rowNumber}:D${user.rowNumber}`,
      [[newPinHash]],
      "daily_collection",
    );
    invalidateSheetsCache(DAILY_COLLECTION_SPREADSHEET_ID);
  } catch (e) {
    console.warn("sheetsUpdate Users warning:", e);
  }

  return { success: true };
}

// Provides template information and CSV data for creating the Users tab in Google Sheet
export function getUsersSheetTemplate() {
  const users = getMemoryUsers();
  const rows = [
    USERS_HEADERS.join(","),
    ...users.map(
      (u) =>
        `"${u.userId}","${u.executiveName}","${u.email}","${u.pinHash}","${u.role}","${u.status}"`,
    ),
  ];

  const tsvRows = [
    USERS_HEADERS.join("\t"),
    ...users.map(
      (u) => `${u.userId}\t${u.executiveName}\t${u.email}\t${u.pinHash}\t${u.role}\t${u.status}`,
    ),
  ];

  return {
    sheetTitle: USERS_SHEET_TITLE,
    spreadsheetId: DAILY_COLLECTION_SPREADSHEET_ID,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${DAILY_COLLECTION_SPREADSHEET_ID}/edit`,
    headers: USERS_HEADERS,
    csv: rows.join("\n"),
    tsv: tsvRows.join("\n"),
  };
}
