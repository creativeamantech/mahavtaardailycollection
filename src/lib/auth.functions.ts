import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const COOKIE = "mahavtaar_auth";
// Keep users signed in across browser restarts; users can end the session with Logout.
const AUTH_TTL_SECONDS = 365 * 24 * 60 * 60;

type User = {
  name: string;
  role: "Admin" | "Executive";
  pin: string;
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
function readUsers(): User[] {
  const raw = process.env["LOGIN_CREDENTIALS"];
  if (!raw?.trim()) throw new Error("LOGIN_CREDENTIALS secret is not configured.");
  const users: User[] = [];
  const seen = new Set<string>();
  // Supports both one-line semicolon-separated credentials and legacy multiline entries.
  const entries = raw.split(/[;\r\n]+/);
  for (const [index, line] of entries.entries()) {
    const entry = line.trim();
    if (!entry) continue;
    const parts = entry.split("_");
    if (parts.length !== 3)
      throw new Error("Invalid LOGIN_CREDENTIALS entry on line " + (index + 1) + ".");
    const [name, roleText, pin] = parts.map((part) => part.trim());
    const role = roleText?.toLowerCase();
    if (!name || !pin || (role !== "admin" && role !== "executive"))
      throw new Error("Invalid LOGIN_CREDENTIALS entry on line " + (index + 1) + ".");
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate user in LOGIN_CREDENTIALS: " + name + ".");
    seen.add(key);
    users.push({ name, role: role === "admin" ? "Admin" : "Executive", pin });
  }
  if (!users.length) throw new Error("LOGIN_CREDENTIALS contains no users.");
  return users;
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

function sign(value: string, pin: string): string {
  return createHmac("sha256", pin).update(value).digest("base64url");
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

function verifySignedToken(
  token: string,
  users: User[],
): { claims: AuthClaims; user: User } | null {
  try {
    if (token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
      alg?: string;
      typ?: string;
    };
    const claims = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Partial<AuthClaims>;
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
    )
      return null;
    const user = users.find(
      (candidate) => candidate.name === claims.sub && candidate.role === claims.role,
    );
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

function verifyPin(pin: string, stored: string) {
  const expected = createHash("sha256").update(stored).digest();
  const actual = createHash("sha256").update(pin).digest();
  return timingSafeEqual(actual, expected);
}

export const loginWithPin = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) =>
    z
      .object({
        executiveName: z.string().trim().min(1).max(100),
        pin: z.string().min(1).max(100),
      })
      .parse(v),
  )
  .handler(async ({ data }) => {
    const users = readUsers();
    const user = users.find((candidate) => candidate.name === data.executiveName);
    if (!user || !verifyPin(data.pin, user.pin))
      throw new Error("Executive name or PIN is incorrect.");
    const token = issueSignedToken(user);
    setAuthCookie(token, AUTH_TTL_SECONDS);
    return { name: user.name, role: user.role };
  });

export const getCurrentSession = createServerFn({ method: "GET" }).handler(async () => {
  const token = cookieToken();
  if (!token) return null;
  // Re-read deployment credentials so PIN or role changes invalidate old sessions.
  const verified = verifySignedToken(token, readUsers());
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
