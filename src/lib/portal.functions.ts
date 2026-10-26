import { createServerFn } from "@tanstack/react-start";
import { requireAppAuth } from "./app-auth.server";
import { z } from "zod";
import {
  PORTAL_EXECUTIVES,
  SESSION_REASONS,
  type ExecutiveSchedule,
  type PortalExecutive,
  type SessionReason,
} from "./portal-types";
import {
  computeLivePortalStatus,
  startSessionOnServer,
  endSessionOnServer,
  recoverAbandonedSession,
  submitComplaintOrQuery,
  escalateQueryToComplaint,
  adminVerifyComplaint,
  adminIssueWarning,
  adminImposeBan,
  adminRevokeBan,
  getPortalReportsData,
  saveSchedulesOnServer,
  getBankPortalSpreadsheetDetails,
  setBankPortalSpreadsheet,
  createBankPortalDedicatedSpreadsheet,
} from "./portal.server";
import { driveUpload } from "./mahavtaar.server";

// Admin password is verified against the SETTINGS_PASSWORD server secret via
// the shared guard — the password value never lives in client code.
import { checkSettingsPassword } from "./password-guard.server";

function checkAdminPassword(password: string | undefined): boolean {
  return checkSettingsPassword(password);
}

export const getLivePortalStatus = createServerFn({ method: "GET" }).middleware([requireAppAuth]).handler(async () => {
  return computeLivePortalStatus();
});

export const startPortalSession = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        executive: z.enum(PORTAL_EXECUTIVES),
        reason: z.enum(SESSION_REASONS),
        customReason: z.string().max(300).optional(),
        forceOverride: z.boolean().optional(),
        adminPassword: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    // Emergency overrides skip schedule checks, so they require the admin
    // password even though the override flag arrives from the client.
    if (data.forceOverride && !checkAdminPassword(data.adminPassword)) {
      throw new Error("Unauthorized: Invalid administrator password.");
    }
    const res = await startSessionOnServer({
      executive: data.executive as PortalExecutive,
      reason: data.reason as SessionReason,
      customReason: data.customReason,
      forceOverride: data.forceOverride,
    });
    if (!res.ok) {
      throw new Error(res.error ?? "Failed to start session.");
    }
    return res;
  });

export const endPortalSession = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        executive: z.enum(PORTAL_EXECUTIVES),
        sessionId: z.string().optional(),
        note: z.string().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const res = await endSessionOnServer({
      executive: data.executive as PortalExecutive,
      sessionId: data.sessionId,
      note: data.note,
    });
    if (!res.ok) {
      throw new Error(res.error ?? "Failed to end session.");
    }
    return res;
  });

export const recoverPortalSession = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        adminPassword: z.string().min(1),
        adminActor: z.string().default("Aman"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!checkAdminPassword(data.adminPassword)) {
      throw new Error("Unauthorized: Invalid administrator password.");
    }
    return await recoverAbandonedSession(data.adminActor);
  });

export const submitPortalQuery = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        complainant: z.enum(PORTAL_EXECUTIVES),
        concernedExecutive: z.enum(PORTAL_EXECUTIVES),
        subject: z.string().min(2).max(120),
        description: z.string().min(5).max(1500),
        loanRef: z.string().max(60).optional(),
        evidenceUrl: z.string().max(800).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return await submitComplaintOrQuery({
      complainant: data.complainant as PortalExecutive,
      concernedExecutive: data.concernedExecutive as PortalExecutive,
      subject: data.subject,
      description: data.description,
      loanRef: data.loanRef,
      evidenceUrl: data.evidenceUrl,
    });
  });

export const escalateQuery = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        complaintId: z.string().min(1),
        complainant: z.enum(PORTAL_EXECUTIVES),
        evidenceUrl: z.string().max(800).optional(),
        escalationNote: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const res = await escalateQueryToComplaint({
      complaintId: data.complaintId,
      complainant: data.complainant as PortalExecutive,
      evidenceUrl: data.evidenceUrl,
      escalationNote: data.escalationNote,
    });
    if (!res.ok) {
      throw new Error(res.error ?? "Failed to escalate query.");
    }
    return res;
  });

export const verifyComplaintAction = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        adminPassword: z.string().min(1),
        complaintId: z.string().min(1),
        decision: z.enum(["Verified — Valid", "Dismissed — Invalid", "Insufficient Evidence"]),
        adminRemarks: z.string().min(2).max(800),
        adminActor: z.string().default("Aman"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!checkAdminPassword(data.adminPassword)) {
      throw new Error("Unauthorized: Invalid administrator password.");
    }
    const res = await adminVerifyComplaint({
      complaintId: data.complaintId,
      decision: data.decision,
      adminRemarks: data.adminRemarks,
      adminActor: data.adminActor,
    });
    if (!res.ok) {
      throw new Error(res.error ?? "Failed to verify complaint.");
    }
    return res;
  });

export const issueWarningAction = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        adminPassword: z.string().min(1),
        complaintId: z.string().min(1),
        executive: z.enum(PORTAL_EXECUTIVES),
        reason: z.string().min(2).max(500),
        adminActor: z.string().default("Aman"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!checkAdminPassword(data.adminPassword)) {
      throw new Error("Unauthorized: Invalid administrator password.");
    }
    const res = await adminIssueWarning({
      complaintId: data.complaintId,
      executive: data.executive as PortalExecutive,
      reason: data.reason,
      adminActor: data.adminActor,
    });
    if (!res.ok) {
      throw new Error(res.error ?? "Failed to issue warning.");
    }
    return res;
  });

export const imposeBanAction = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        adminPassword: z.string().min(1),
        complaintId: z.string().optional(),
        executive: z.enum(PORTAL_EXECUTIVES),
        reason: z.string().min(2).max(500),
        adminActor: z.string().default("Aman"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!checkAdminPassword(data.adminPassword)) {
      throw new Error("Unauthorized: Invalid administrator password.");
    }
    const res = await adminImposeBan({
      complaintId: data.complaintId,
      executive: data.executive as PortalExecutive,
      reason: data.reason,
      adminActor: data.adminActor,
    });
    if (!res.ok) {
      throw new Error(res.error ?? "Failed to impose ban.");
    }
    return res;
  });

export const revokeBanAction = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        adminPassword: z.string().min(1),
        banId: z.string().min(1),
        revokeReason: z.string().min(2).max(500),
        adminActor: z.string().default("Aman"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!checkAdminPassword(data.adminPassword)) {
      throw new Error("Unauthorized: Invalid administrator password.");
    }
    const res = await adminRevokeBan({
      banId: data.banId,
      revokeReason: data.revokeReason,
      adminActor: data.adminActor,
    });
    if (!res.ok) {
      throw new Error(res.error ?? "Failed to revoke ban.");
    }
    return res;
  });

export const getPortalReports = createServerFn({ method: "GET" }).middleware([requireAppAuth]).handler(async () => {
  return await getPortalReportsData();
});

export const savePortalSchedules = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        adminPassword: z.string().min(1),
        schedules: z.array(
          z.object({
            executive: z.enum(PORTAL_EXECUTIVES),
            isAvailable: z.boolean(),
            notes: z.string().optional(),
            slots: z.array(
              z.object({
                start: z.string().regex(/^\d{2}:\d{2}$/),
                end: z.string().regex(/^\d{2}:\d{2}$/),
                label: z.string(),
              }),
            ),
          }),
        ),
        adminActor: z.string().default("Aman"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!checkAdminPassword(data.adminPassword)) {
      throw new Error("Unauthorized: Invalid administrator password.");
    }
    return await saveSchedulesOnServer(data.schedules as ExecutiveSchedule[], data.adminActor);
  });

export const uploadPortalEvidence = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().max(120),
        mimeType: z.string().max(80),
        base64: z.string().max(9_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const cleanBase64 = data.base64.includes(",")
      ? data.base64.slice(data.base64.indexOf(",") + 1)
      : data.base64;
    const link = await driveUpload(data.name, data.mimeType, cleanBase64);
    return { ok: true, link };
  });

export const getBankPortalSheetConfig = createServerFn({ method: "GET" }).middleware([requireAppAuth]).handler(async () => {
  return await getBankPortalSpreadsheetDetails();
});

export const updateBankPortalSheetConfig = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        adminPassword: z.string().min(1),
        spreadsheetInput: z.string().min(1),
        adminActor: z.string().default("Aman"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!checkAdminPassword(data.adminPassword)) {
      throw new Error("Unauthorized: Invalid administrator password.");
    }
    const res = await setBankPortalSpreadsheet({
      spreadsheetInput: data.spreadsheetInput,
      adminActor: data.adminActor,
    });
    if (!res.ok) {
      throw new Error(res.message);
    }
    return res;
  });

export const createDedicatedBankPortalSheet = createServerFn({ method: "POST" }).middleware([requireAppAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        adminPassword: z.string().min(1),
        title: z.string().max(100).optional(),
        adminActor: z.string().default("Aman"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!checkAdminPassword(data.adminPassword)) {
      throw new Error("Unauthorized: Invalid administrator password.");
    }
    const res = await createBankPortalDedicatedSpreadsheet({
      title: data.title,
      adminActor: data.adminActor,
    });
    if (!res.ok) {
      throw new Error(res.message);
    }
    return res;
  });
