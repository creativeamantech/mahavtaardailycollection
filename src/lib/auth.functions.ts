import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, getRequestHeader, setCookie } from "@tanstack/react-start/server";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const COOKIE = "mahavtaar_auth";
const AUTH_TTL_SECONDS = 8 * 60 * 60;
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
type AuthClaims = {
  sub: string;
  role: "Admin" | "Executive";
  iat: number;
  exp: number;
  jti: string;
  iss: "mahavtaar-daily-collection";
  ver: 1;
};
type Attempt = { count: number; lockedUntil: number };

const loginAttempts = new Map<string, Attempt>();

async function readUsers(): Promise<User[]> {
  const { sheetsGetFresh } = await import("./mahavtaar.server");
  const rows = await sheetsGetFresh("Users!A2:E");
  return rows
    .map((r, index): User | null => {
      const roleText = String(r[3] ?? "").trim().toLowerCase();
      if (roleText !== "admin" && roleText !== "executive") return null;
      return {
        name: String(r[1] ?? "").trim(),
        pin: String(r[2] ?? "").trim(),
        role: roleText === "admin" ? "Admin" : "Executive",
        status: String(r[4] ?? "").trim().toLowerCase(),
        rowNumber: index + 2,
      };
    })
    .filter((u): u is User => Boolean(u?.name && u.status === "active"));
}

function cookieToken() {
  return getCookie(COOKIE) ?? "";
}

function setAuthCookie(value: string, maxAge: number) {
  const options = {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  deleteCookie("mahavtaar_session", options); // Remove the legacy database-session cookie.
  if (value) setCookie(COOKIE, value, { ...options, maxAge });
  else deleteCookie(COOKIE, options);
}

function encodePart(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(value: string, pinHash: string): string {
  // Use the user's existing PIN hash from the private Users sheet as the
  // per-user signing key. This avoids introducing another deployment secret.
  return createHmac("sha256", pinHash).update(value).digest("base64url");
}

function issueSignedToken(user: Pick<User, "name" | "role" | "pin">): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: AuthClaims = {
    sub: user.name,
    role: user.role,
    iat: now,
    exp: now + AUTH_TTL_SECONDS,
    jti: randomBytes(16).toString("hex"),
    iss: "mahavtaar-daily-collection",
    ver: 1,
  };
  const unsigned = encodePart({ alg: "HS256", typ: "JWT" }) + "." + encodePart(claims);
  return unsigned + "." + sign(unsigned, user.pin);
}

function verifySignedToken(token: string, users: User[]): { claims: AuthClaims; user: User } | null {
  try {
    if (token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
      alg?: string;
      typ?: string;
    };
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Partial<AuthClaims>;
    const now = Math.floor(Date.now() / 1000);
    if (
      header.alg !== "HS256" ||
      header.typ !== "JWT" ||
      claims.iss !== "mahavtaar-daily-collection" ||
      claims.ver !== 1 ||
      typeof claims.sub !== "string" ||
      !claims.sub.trim() ||
      (claims.role !== "Admin" && claims.role !== "Executive") ||
      typeof claims.iat !== "number" ||
      typeof claims.exp !== "number" ||
      typeof claims.jti !== "string" ||
      claims.iat > now + 60 ||
      claims.exp <= now ||
      claims.exp - claims.iat > AUTH_TTL_SECONDS
    ) return null;
    const user = users.find((candidate) => candidate.name === claims.sub && candidate.role === claims.role);
    if (!user?.pin) return null;
    const unsigned = parts[0] + "." + parts[1];
    const expected = Buffer.from(sign(unsigned, user.pin), "base64url");
    const supplied = Buffer.from(parts[2], "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    return { claims: claims as AuthClaims, user };
  } catch {
    return null;
  }
}

function hashPin(pin: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("hex"), hash.toString("hex")].join("$");
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
  const forwarded = (getRequestHeader("x-forwarded-for") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const ip = getRequestHeader("cf-connecting-ip")?.trim() || forwarded.at(-1) || "unknown";
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

export const getLoginUsers = createServerFn({ method: "GET" }).handler(async () => {
  return (await readUsers()).map(({ name }) => name).sort((a, b) => a.localeCompare(b));
});

export const loginWithPin = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z.object({
      executiveName: z.string().trim().min(1).max(100),
      pin: z.string().min(1).max(100),
    }).parse(v),
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
      user.pin = hashPin(data.pin);
      await sheetsUpdateStrict("Users!C" + user.rowNumber, [[user.pin]]);
    }
    const token = issueSignedToken(user);
    setAuthCookie(token, AUTH_TTL_SECONDS);
    return { name: user.name, role: user.role };
  });

export const getCurrentSession = createServerFn({ method: "GET" }).handler(async () => {
  const token = cookieToken();
  if (!token) return null;
  // The active user's current PIN hash in the private Users sheet verifies
  // the token signature. No AppSessions row or additional secret is needed.
  const verified = verifySignedToken(token, await readUsers());
  if (!verified) {
    setAuthCookie("", 0);
    return null;
  }
  return { name: verified.user.name, role: verified.user.role };
});

export const logoutCurrentSession = createServerFn({ method: "POST" }).handler(async () => {
  // Stateless tokens cannot be individually revoked. Logout removes this
  // browser's HttpOnly cookie; any copied token expires within eight hours.
  setAuthCookie("", 0);
  return { ok: true as const };
});

export async function requireSession(requiredRole?: "Admin" | "Executive") {
  const session = await getCurrentSession();
  if (!session) throw new Error("Authentication required. Please log in again.");
  if (requiredRole && session.role !== requiredRole)
    throw new Error("Administrator access required.");
  return session;
}
