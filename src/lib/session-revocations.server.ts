const TABLE_URL = "/rest/v1/app_session_revocations";

function databaseConfig() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error("Secure session revocation storage is not configured.");
  }
  return { baseUrl: url.replace(/\/$/, ""), key };
}

function serviceHeaders(key: string, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  return headers;
}

export async function isSessionRevoked(tokenHash: string): Promise<boolean> {
  const { baseUrl, key } = databaseConfig();
  const params = new URLSearchParams({
    select: "token_hash",
    token_hash: `eq.${tokenHash}`,
    expires_at: `gt.${new Date().toISOString()}`,
    limit: "1",
  });
  const response = await fetch(`${baseUrl}${TABLE_URL}?${params}`, {
    headers: serviceHeaders(key),
  });
  if (!response.ok) {
    console.error("Session revocation lookup failed:", response.status);
    throw new Error("Could not verify the sign-in session.");
  }
  const rows = (await response.json()) as Array<{ token_hash: string }>;
  return rows.length > 0;
}

export async function revokeSession(tokenHash: string, expiresAtSeconds: number) {
  const { baseUrl, key } = databaseConfig();
  const response = await fetch(`${baseUrl}${TABLE_URL}`, {
    method: "POST",
    headers: serviceHeaders(key, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({
      token_hash: tokenHash,
      expires_at: new Date(expiresAtSeconds * 1000).toISOString(),
    }),
  });
  if (!response.ok) {
    console.error("Session revocation write failed:", response.status);
    throw new Error("Could not securely end this session. Please try again.");
  }

  const cleanupParams = new URLSearchParams({
    expires_at: `lt.${new Date().toISOString()}`,
  });
  try {
    await fetch(`${baseUrl}${TABLE_URL}?${cleanupParams}`, {
      method: "DELETE",
      headers: serviceHeaders(key, { Prefer: "return=minimal" }),
    });
  } catch {
    // Expired rows are harmless; cleanup must not undo a successful logout.
  }
}