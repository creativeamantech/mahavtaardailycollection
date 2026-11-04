import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, getRequestHeader, setCookie } from "@tanstack/react-start/server";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { z } from "zod";

const COOKIE = "mahavtaar_session";
const SESSION_TTL = 8 * 60 * 60 * 1000;
const SESSION_CACHE_TTL = 15_000;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
type User = {
  name: string;
  role: "Admin" | "Executive";
  pin: string;
  status: string;
  rowNumber: number;
};
type Session = { name: string; role: "Admin" | "Executive"; expiresAt: number; rowNumber: number };
type Attempt = { count: number; lockedUntil: number };

const sessionCache = new Map<string, Session>();
let sessionCacheLoadedAt = 0;
const loginAttempts = new Map<string, Attempt>();

async function readUsers(): Promise<User[]> {
  const { sheetsGet } = await import("./mahavtaar.server");
  const rows = await sheetsGet("Users!A2:E");
  return rows
    .map((r, index): User | null => {
      const roleText = String(r[3] ?? "")
        .trim()
        .toLowerCase();
      if (roleText !== "admin" && roleText !== "executive") return null;
      return {
        name: String(r[1] ?? "").trim(),
        pin: String(r[2] ?? "").trim(),
        role: roleText === "admin" ? "Admin" : "Executive",
        status: String(r[4] ?? "")
          .trim()
          .toLowerCase(),
        rowNumber: index + 2,
      };
    })
    .filter((u): u is User => Boolean(u?.name && u.status === "active"));
}

function cookieToken() {
  return getCookie(COOKIE) ?? "";
}

function setSessionCookie(value: string, maxAge: number) {
  const options = {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  if (value) {
    setCookie(COOKIE, value, { ...options, maxAge });
  } else {
    deleteCookie(COOKIE, options);
  }
}

async function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken() {
  return randomBytes(32).toString("hex");
}

function hashPin(pin: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("hex"), hash.toString("hex")].join(
    "$",
  );
}

function verifyPin(pin: string, stored: string) {
  if (stored.startsWith("scrypt$")) {
    const [, n, r, p, saltHex, hashHex] = stored.split("$");
    if (!n || !r || !p || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length !== 64) return false;
    const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), 64, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  }
  const expected = createHash("sha256").update(stored).digest();
  const actual = createHash("sha256").update(pin).digest();
  return timingSafeEqual(actual, expected);
}

function rateLimitKeys(userName: string) {
  // Prefer the edge-provided client address. If unavailable, use the final
  // proxy-added X-Forwarded-For hop rather than a client-supplied first value.
  const forwarded = (getRequestHeader("x-forwarded-for") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const ip =
    getRequestHeader("cf-connecting-ip")?.trim() ||
    forwarded.at(-1) ||
    "unknown";
  return ["user:" + userName.toLowerCase(), "ip:" + ip];
}

function assertNotRateLimited(keys: string[]) {
  const now = Date.now();
  for (const key of keys) {
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.lockedUntil > now)
      throw new Error("Too many login attempts. Please wait before trying again.");
  }
}

function recordFailedLogin(keys: string[]) {
  const now = Date.now();
  for (const key of keys) {
    const previous = loginAttempts.get(key) ?? { count: 0, lockedUntil: 0 };
    const count = previous.count + 1;
    const delay = count < 5 ? 0 : Math.min(15 * 60_000, 30_000 * 2 ** (count - 5));
    loginAttempts.set(key, { count, lockedUntil: now + delay });
  }
}

function clearLoginFailures(keys: string[]) {
  for (const key of keys) loginAttempts.delete(key);
}

async function refreshSessionCache(force = false) {
  if (!force && Date.now() - sessionCacheLoadedAt < SESSION_CACHE_TTL) return;
  const { sheetsGet } = await import("./mahavtaar.server");
  const rows = await sheetsGet("AppSessions!A2:F");
  const next = new Map<string, Session>();
  const now = Date.now();
  rows.forEach((row, index) => {
    const tokenHash = String(row[0] ?? "");
    const name = String(row[1] ?? "").trim();
    const role = String(row[2] ?? "").trim();
    const expiresAt = Date.parse(String(row[4] ?? ""));
    const revoked =
      String(row[5] ?? "")
        .trim()
        .toLowerCase() === "yes";
    if (
      tokenHash &&
      name &&
      (role === "Admin" || role === "Executive") &&
      !revoked &&
      expiresAt > now
    ) {
      next.set(tokenHash, { name, role, expiresAt, rowNumber: index + 2 });
    }
  });
  sessionCache.clear();
  for (const [key, value] of next) sessionCache.set(key, value);
  sessionCacheLoadedAt = now;
}

async function revokeSessionHash(tokenHash: string) {
  await refreshSessionCache();
  const session = sessionCache.get(tokenHash);
  if (!session) return;
  const { sheetsUpdateStrict } = await import("./mahavtaar.server");
  await sheetsUpdateStrict("AppSessions!F" + session.rowNumber, [["Yes"]]);
  sessionCache.delete(tokenHash);
}

export const getLoginUsers = createServerFn({ method: "GET" }).handler(async () => {
  return (await readUsers()).map(({ name }) => name).sort((a, b) => a.localeCompare(b));
});

export const loginWithPin = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z
      .object({ executiveName: z.string().trim().min(1).max(100), pin: z.string().min(1).max(100) })
      .parse(v),
  )
  .handler(async ({ data }) => {
    const keys = rateLimitKeys(data.executiveName);
    assertNotRateLimited(keys);
    const users = await readUsers();
    const user = users.find((candidate) => candidate.name === data.executiveName);
    if (!user || !user.pin || !verifyPin(data.pin, user.pin)) {
      recordFailedLogin(keys);
      throw new Error("Executive name or PIN is incorrect.");
    }
    clearLoginFailures(keys);
    if (!user.pin.startsWith("scrypt$")) {
      const { sheetsUpdateStrict } = await import("./mahavtaar.server");
      await sheetsUpdateStrict("Users!C" + user.rowNumber, [[hashPin(data.pin)]]);
    }
    const existingToken = cookieToken();
    if (existingToken) await revokeSessionHash(await digest(existingToken));
    const token = randomToken();
    const tokenHash = await digest(token);
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_TTL);
    const { ensureSheetStrict, sheetsAppendStrict } = await import("./mahavtaar.server");
    await ensureSheetStrict("AppSessions", [
      "Token_Hash",
      "Executive_Name",
      "Role",
      "Created_At",
      "Expires_At",
      "Revoked",
    ]);
    await sheetsAppendStrict("AppSessions!A:F", [
      [tokenHash, user.name, user.role, now.toISOString(), expires.toISOString(), "No"],
    ]);
    await refreshSessionCache(true);
    setSessionCookie(token, SESSION_TTL / 1000);
    return { name: user.name, role: user.role };
  });

export const getCurrentSession = createServerFn({ method: "GET" }).handler(async () => {
  const token = cookieToken();
  if (!token) return null;
  const hash = await digest(token);
  await refreshSessionCache();
  const session = sessionCache.get(hash);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessionCache.delete(hash);
    return null;
  }
  const user = (await readUsers()).find(
    (candidate) => candidate.name === session.name && candidate.role === session.role,
  );
  if (!user) {
    sessionCache.delete(hash);
    return null;
  }
  return { name: user.name, role: user.role };
});

export const logoutCurrentSession = createServerFn({ method: "POST" }).handler(async () => {
  const token = cookieToken();
  if (token) await revokeSessionHash(await digest(token));
  setSessionCookie("", 0);
  return { ok: true as const };
});

export async function requireSession(requiredRole?: "Admin" | "Executive") {
  const session = await getCurrentSession();
  if (!session) throw new Error("Authentication required. Please log in again.");
  if (requiredRole && session.role !== requiredRole)
    throw new Error("Administrator access required.");
  return session;
}
