import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

const COOKIE = "mahavtaar_session";
const SESSION_TTL = 8 * 60 * 60 * 1000;
type User = { name: string; role: "Admin" | "Executive"; pin: string; status: string };

async function readUsers(): Promise<User[]> {
  const { sheetsGet } = await import("./mahavtaar.server");
  const rows = await sheetsGet("Users!A2:E");
  return rows
    .map((r): User | null => {
      const roleText = String(r[3] ?? "").trim().toLowerCase();
      if (roleText !== "admin" && roleText !== "executive") return null;
      return {
        name: String(r[1] ?? "").trim(),
        pin: String(r[2] ?? "").trim(),
        role: roleText === "admin" ? "Admin" : "Executive",
        status: String(r[4] ?? "").trim().toLowerCase(),
      };
    })
    .filter((u): u is User => Boolean(u?.name && u.status === "active"));
}

function cookieToken() {
  const cookie = getRequestHeader("cookie") ?? "";
  const item = cookie.split(";").map((s) => s.trim()).find((s) => s.startsWith(COOKIE + "="));
  return item ? decodeURIComponent(item.slice(COOKIE.length + 1)) : "";
}
function setSessionCookie(value: string, maxAge: number) {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  setResponseHeader("Set-Cookie", value
    ? COOKIE + "=" + encodeURIComponent(value) + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + maxAge + secure
    : COOKIE + "=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" + secure);
}
async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const getLoginUsers = createServerFn({ method: "GET" }).handler(async () => {
  return (await readUsers()).map(({ name }) => name).sort((a, b) => a.localeCompare(b));
});

export const loginWithPin = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => z.object({ executiveName: z.string().trim().min(1).max(100), pin: z.string().min(1).max(100) }).parse(v))
  .handler(async ({ data }) => {
    const user = (await readUsers()).find((u) => u.name === data.executiveName);
    if (!user || !user.pin || user.pin !== data.pin) throw new Error("Executive name or PIN is incorrect.");
    const token = randomToken();
    const tokenHash = await digest(token);
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_TTL);
    const { ensureSheetStrict, sheetsAppendStrict } = await import("./mahavtaar.server");
    await ensureSheetStrict("AppSessions", ["Token_Hash", "Executive_Name", "Role", "Created_At", "Expires_At", "Revoked"]);
    await sheetsAppendStrict("AppSessions!A:F", [[tokenHash, user.name, user.role, now.toISOString(), expires.toISOString(), "No"]]);
    setSessionCookie(token, SESSION_TTL / 1000);
    return { name: user.name, role: user.role };
  });

export const getCurrentSession = createServerFn({ method: "GET" }).handler(async () => {
  const token = cookieToken();
  if (!token) return null;
  const hash = await digest(token);
  const { sheetsGet } = await import("./mahavtaar.server");
  const sessions = await sheetsGet("AppSessions!A2:F");
  const row = sessions.find((r) => r[0] === hash && String(r[5] ?? "").toLowerCase() !== "yes" && Date.parse(r[4] ?? "") > Date.now());
  if (!row) return null;
  const user = (await readUsers()).find((u) => u.name === row[1] && u.role === row[2]);
  if (!user) return null;
  return { name: user.name, role: user.role };
});

export const logoutCurrentSession = createServerFn({ method: "POST" }).handler(async () => {
  const token = cookieToken();
  if (token) {
    const hash = await digest(token);
    const { sheetsGet, sheetsUpdateStrict } = await import("./mahavtaar.server");
    const rows = await sheetsGet("AppSessions!A2:F");
    const idx = rows.findIndex((r) => r[0] === hash);
    if (idx >= 0) await sheetsUpdateStrict("AppSessions!F" + (idx + 2), [["Yes"]]);
  }
  setSessionCookie("", 0);
  return { ok: true as const };
});

export async function requireSession(requiredRole?: "Admin" | "Executive") {
  const session = await getCurrentSession();
  if (!session) throw new Error("Authentication required. Please log in again.");
  if (requiredRole && session.role !== requiredRole) throw new Error("Administrator access required.");
  return session;
}
