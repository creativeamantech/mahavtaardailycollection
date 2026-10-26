import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAuth } from "./app-auth.server";
import { requireSettingsPassword } from "./password-guard.server";
import {
  isEmailAllowed,
  getAllowedEmailsList,
  addAllowedEmail,
  removeAllowedEmail,
} from "./auth-allowlist.server";

// Public check called during /login signup to verify whether an email is eligible
export const checkEmailAllowed = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ email: z.string().trim().toLowerCase().max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const allowed = await isEmailAllowed(data.email);
    return { allowed };
  });

// Settings-protected endpoint to view all approved emails
export const getApprovedEmails = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .inputValidator((d: unknown) => z.object({ password: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    requireSettingsPassword(data.password);
    const emails = await getAllowedEmailsList();
    return { emails };
  });

// Settings-protected endpoint to add a new approved email
export const addApprovedEmailAction = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        password: z.string().max(200),
        email: z
          .string()
          .trim()
          .toLowerCase()
          .email("Please enter a valid email address.")
          .max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    requireSettingsPassword(data.password);
    return await addAllowedEmail(data.email);
  });

// Settings-protected endpoint to remove an approved email
export const removeApprovedEmailAction = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        password: z.string().max(200),
        email: z.string().trim().toLowerCase().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    requireSettingsPassword(data.password);
    return await removeAllowedEmail(data.email);
  });
