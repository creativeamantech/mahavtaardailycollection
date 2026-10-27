import fs from "fs";
import path from "path";

export interface AllowedEmailEntry {
  email: string;
  createdAt: string;
}

const FALLBACK_FILE_PATH = path.resolve(process.cwd(), "allowed-emails.json");
const DEFAULT_INITIAL_EMAILS: string[] = ["jain9640@gmail.com"];

export function hasSupabaseAdmin(): boolean {
  return Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}

function loadLocalAllowedEmails(): AllowedEmailEntry[] {
  try {
    if (fs.existsSync(FALLBACK_FILE_PATH)) {
      const raw = fs.readFileSync(FALLBACK_FILE_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => item && typeof item.email === "string" && item.email.trim())
          .map((item) => ({
            email: String(item.email).trim().toLowerCase(),
            createdAt: item.createdAt || new Date().toISOString(),
          }));
      }
    }
  } catch (err) {
    console.warn("Could not read allowed-emails.json:", err);
  }

  // Initial seed if file does not exist
  const initial = DEFAULT_INITIAL_EMAILS.map((email) => ({
    email: email.trim().toLowerCase(),
    createdAt: new Date().toISOString(),
  }));
  saveLocalAllowedEmails(initial);
  return initial;
}

function saveLocalAllowedEmails(entries: AllowedEmailEntry[]) {
  try {
    fs.writeFileSync(FALLBACK_FILE_PATH, JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    console.warn("Could not write allowed-emails.json:", err);
  }
}

export async function getAllowedEmailsList(): Promise<AllowedEmailEntry[]> {
  if (hasSupabaseAdmin()) {
    try {
      const { createAdminClient } = await import("./supabase-admin.server");
      const admin = createAdminClient();
      const { data: rows, error } = await admin
        .from("allowed_emails")
        .select("email, created_at")
        .order("created_at", { ascending: false });

      if (!error && Array.isArray(rows)) {
        const mapped: AllowedEmailEntry[] = rows
          .filter((r) => r && r.email)
          .map((r) => ({
            email: (r.email ?? "").trim().toLowerCase(),
            createdAt: r.created_at ?? new Date().toISOString(),
          }));

        // Persist to local backup
        saveLocalAllowedEmails(mapped);
        return mapped;
      }
      if (error) {
        console.warn("Supabase allowed_emails read notice:", error.message);
      }
    } catch (err) {
      console.warn("Failed to read Supabase allowed_emails, using local store:", err);
    }
  }

  return loadLocalAllowedEmails();
}

export async function isEmailAllowed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const list = await getAllowedEmailsList();
  return list.some((item) => item.email === normalized);
}

export async function addAllowedEmail(
  email: string,
): Promise<{ ok: boolean; email: string; message: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw new Error("Invalid email format.");
  }

  const existingList = await getAllowedEmailsList();
  if (existingList.some((item) => item.email === normalized)) {
    throw new Error(`Email "${normalized}" is already on the approved list.`);
  }

  const newEntry: AllowedEmailEntry = {
    email: normalized,
    createdAt: new Date().toISOString(),
  };

  if (hasSupabaseAdmin()) {
    try {
      const { createAdminClient } = await import("./supabase-admin.server");
      const admin = createAdminClient();
      const { error } = await admin.from("allowed_emails").insert({
        email: normalized,
        created_at: newEntry.createdAt,
      });

      if (error) {
        console.error("Supabase allowed_emails insert error:", error);
        throw new Error(error.message || "Failed to add email to database.");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Failed to add")) {
        throw err;
      }
      console.warn("Supabase insert notice, proceeding with local fallback:", err);
    }
  }

  // Update local file backup
  const updatedList = [newEntry, ...existingList.filter((e) => e.email !== normalized)];
  saveLocalAllowedEmails(updatedList);

  return {
    ok: true,
    email: normalized,
    message: `Email ${normalized} has been successfully added to approved sign-ups.`,
  };
}

export async function removeAllowedEmail(
  email: string,
): Promise<{ ok: boolean; email: string; message: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Invalid email.");
  }

  if (hasSupabaseAdmin()) {
    try {
      const { createAdminClient } = await import("./supabase-admin.server");
      const admin = createAdminClient();
      const { error } = await admin.from("allowed_emails").delete().eq("email", normalized);

      if (error) {
        console.error("Supabase allowed_emails delete error:", error);
        throw new Error(error.message || "Failed to remove email from database.");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Failed to remove")) {
        throw err;
      }
      console.warn("Supabase delete notice, proceeding with local fallback:", err);
    }
  }

  const existingList = await getAllowedEmailsList();
  const updatedList = existingList.filter((e) => e.email !== normalized);
  saveLocalAllowedEmails(updatedList);

  return {
    ok: true,
    email: normalized,
    message: `Email ${normalized} has been removed from approved sign-ups.`,
  };
}
