// Server-side shared-password verification.
// The expected password lives only in the SETTINGS_PASSWORD server secret —
// it must never appear in client code or the client bundle.
export function checkSettingsPassword(password: string | undefined | null): boolean {
  if (!password) return false;
  const expected = (process.env["SETTINGS_PASSWORD"] ?? "").trim();
  if (expected === "") {
    console.error("SETTINGS_PASSWORD secret is not configured.");
    return false;
  }
  let diff = password.length === expected.length ? 0 : 1;
  for (let i = 0; i < Math.max(password.length, expected.length); i++) {
    diff |= (password.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function requireSettingsPassword(password: string | undefined | null): void {
  if (!checkSettingsPassword(password)) {
    throw new Error("Unauthorized: Incorrect password.");
  }
}
