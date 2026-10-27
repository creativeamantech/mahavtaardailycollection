import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  authenticateWithGoogleSheet,
  verifySessionToken,
  getAllSheetUsers,
  addSheetUser,
  updateSheetUserStatus,
  updateSheetUserRole,
  resetSheetUserPin,
  verifyAdminSession,
  isUsersTabAvailableInGoogleSheet,
  getUsersSheetTemplate,
  type SheetUserSafe,
} from "./sheet-auth.server";
import { EXECUTIVES } from "./executives";

// Public: Login with Executive Name/Email and PIN against Google Sheet
export const sheetLoginAction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        identifier: z.string().trim().min(1, "Executive name or email is required."),
        pin: z.string().trim().min(1, "PIN is required."),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return await authenticateWithGoogleSheet(data.identifier, data.pin);
  });

// Public: Verify current session token and return user profile
export const sheetGetCurrentUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().nullable().optional() }).parse(d))
  .handler(async ({ data }) => {
    if (!data.token) return { user: null };
    const session = verifySessionToken(data.token);
    if (!session || session.status !== "Active") return { user: null };
    return {
      user: {
        userId: session.userId,
        executiveName: session.executiveName,
        email: session.email,
        role: session.role,
        status: session.status,
      } as SheetUserSafe,
    };
  });

// Public: Get quick list of executive options for easy selection in login
export const sheetGetLoginOptions = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const users = await getAllSheetUsers();
    if (users.length > 0) {
      return {
        executives: users
          .filter((u) => u.status === "Active")
          .map((u) => ({
            executiveName: u.executiveName,
            role: u.role,
            email: u.email,
          })),
      };
    }
  } catch (e) {
    console.warn("Failed to load users for login list, using EXECUTIVES fallback:", e);
  }

  return {
    executives: [
      { executiveName: "Aman", role: "Admin" as const, email: "aman@mahavtaar.in" },
      ...EXECUTIVES.map((name) => ({
        executiveName: name,
        role: "Executive" as const,
        email: `${name.toLowerCase()}@mahavtaar.in`,
      })),
    ],
  };
});

// Admin: Get all users from the Users tab
export const sheetListUsersAction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().optional(),
        password: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    verifyAdminSession(data.token, data.password);
    const users = await getAllSheetUsers();
    return {
      users: users.map((u) => ({
        userId: u.userId,
        executiveName: u.executiveName,
        email: u.email,
        role: u.role,
        status: u.status,
      })),
    };
  });

// Admin: Add a new user
export const sheetAddUserAction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().optional(),
        password: z.string().optional(),
        executiveName: z.string().trim().min(2, "Executive name must be at least 2 characters."),
        email: z.string().trim().toLowerCase().email("Valid email required."),
        pin: z
          .string()
          .trim()
          .regex(/^\d{4,6}$/, "PIN must be a 4 to 6 digit number."),
        role: z.enum(["Admin", "Executive"]),
        status: z.enum(["Active", "Inactive"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await addSheetUser(
      { token: data.token, password: data.password },
      {
        executiveName: data.executiveName,
        email: data.email,
        pin: data.pin,
        role: data.role,
        status: data.status,
      },
    );
    return { success: true, user };
  });

// Admin: Update user status
export const sheetUpdateUserStatusAction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().optional(),
        password: z.string().optional(),
        userId: z.string().min(1),
        status: z.enum(["Active", "Inactive"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return await updateSheetUserStatus(
      { token: data.token, password: data.password },
      data.userId,
      data.status,
    );
  });

// Admin: Update user role
export const sheetUpdateUserRoleAction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().optional(),
        password: z.string().optional(),
        userId: z.string().min(1),
        role: z.enum(["Admin", "Executive"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return await updateSheetUserRole(
      { token: data.token, password: data.password },
      data.userId,
      data.role,
    );
  });

// Admin: Reset user PIN
export const sheetResetPinAction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().optional(),
        password: z.string().optional(),
        userId: z.string().min(1),
        newPin: z
          .string()
          .trim()
          .regex(/^\d{4,6}$/, "PIN must be a 4 to 6 digit number."),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return await resetSheetUserPin(
      { token: data.token, password: data.password },
      data.userId,
      data.newPin,
    );
  });

// Public / Admin: Check Users tab status in Google Sheet and get setup template
export const sheetGetUsersTabStatusAction = createServerFn({ method: "GET" }).handler(async () => {
  const isPresent = await isUsersTabAvailableInGoogleSheet();
  const template = getUsersSheetTemplate();
  return {
    isPresentInGoogleSheet: isPresent,
    ...template,
  };
});
