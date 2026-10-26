import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Only emails on the approved list may create an account. The list itself is
// not publicly readable; this check runs server-side with the admin client.
export const checkEmailAllowed = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().trim().toLowerCase().max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { createAdminClient } = await import("./supabase-admin.server");
    const admin = createAdminClient();
    const { data: rows, error } = await admin.from("allowed_emails").select("email");
    if (error) {
      console.error("Failed to read the approved-email list:", error.message);
      return { allowed: false as const };
    }
    const allowed = (rows ?? []).some(
      (r) => (r.email ?? "").trim().toLowerCase() === data.email,
    );
    return { allowed };
  });
