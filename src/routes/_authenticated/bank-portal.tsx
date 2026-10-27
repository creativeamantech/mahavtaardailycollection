import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type PortalExecutive } from "@/lib/portal-types";
import {
  ExecutiveAuthModal,
  PORTAL_EXECUTIVE_STORAGE_KEY,
  PORTAL_ADMIN_PASS_STORAGE_KEY,
} from "@/components/portal/ExecutiveAuthModal";
import { LivePortalStatusBanner } from "@/components/portal/LivePortalStatusBanner";
import { StartEndSessionCard } from "@/components/portal/StartEndSessionCard";
import { AccessRequestBanner } from "@/components/portal/AccessRequestBanner";
import { ExecutiveScheduleView } from "@/components/portal/ExecutiveScheduleView";
import { ComplaintsAndQueriesSection } from "@/components/portal/ComplaintsAndQueriesSection";
import { UsageReportsView } from "@/components/portal/UsageReportsView";
import { ComplaintReportsView } from "@/components/portal/ComplaintReportsView";
import { AdminSettingsView } from "@/components/portal/AdminSettingsView";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBankPortalSheetConfig } from "@/lib/portal.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  BarChart3,
  Calendar,
  ExternalLink,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Lock,
  LogIn,
  MessageSquare,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";

import { useSheetAuth } from "@/hooks/useSheetAuth";

export const Route = createFileRoute("/_authenticated/bank-portal")({
  head: () => ({
    meta: [
      { title: "Bank Portal Usage & Accountability — Mahavtaar" },
      {
        name: "description",
        content:
          "Manage bank portal access schedules, temporary sessions, live timers, complaints, warnings, and accountability reports.",
      },
      { property: "og:title", content: "Bank Portal Usage & Accountability" },
      {
        property: "og:description",
        content:
          "Scheduled time-slots and real-time usage accountability for Mahavtaar executives.",
      },
    ],
  }),
  component: BankPortalPage,
});

type TabKey =
  | "live"
  | "schedule"
  | "session"
  | "complaints"
  | "usageReports"
  | "complaintReports"
  | "adminSettings";

function BankPortalPage() {
  const { user } = useSheetAuth();
  const isSheetAdmin = user?.role === "Admin";
  const [currentExecutive, setCurrentExecutive] = useState<PortalExecutive | null>(null);
  const [adminPassword, setAdminPassword] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabKey>("live");
  const [isSwitchingUser, setIsSwitchingUser] = useState(false);

  const fetchSheetConfig = useServerFn(getBankPortalSheetConfig);
  const { data: sheetConfig } = useQuery({
    queryKey: ["portalSheetConfig"],
    queryFn: async () => fetchSheetConfig(),
    staleTime: 20_000,
  });

  useEffect(() => {
    if (user?.executiveName) {
      if (!isSheetAdmin || !currentExecutive) {
        setCurrentExecutive(user.executiveName as PortalExecutive);
        sessionStorage.setItem(PORTAL_EXECUTIVE_STORAGE_KEY, user.executiveName);
      }
    } else {
      const savedExec = sessionStorage.getItem(
        PORTAL_EXECUTIVE_STORAGE_KEY,
      ) as PortalExecutive | null;
      const savedPass = sessionStorage.getItem(PORTAL_ADMIN_PASS_STORAGE_KEY) || "";
      if (savedExec) {
        setCurrentExecutive(savedExec);
        setAdminPassword(savedPass);
      }
    }
  }, [user?.executiveName, isSheetAdmin]);

  const handleSelectExecutive = (exec: PortalExecutive, pass?: string) => {
    setCurrentExecutive(exec);
    setAdminPassword(pass ?? "");
    setIsSwitchingUser(false);
  };

  const handleSwitchUser = () => {
    setIsSwitchingUser(true);
  };

  // 1. Executive Selection: Non-admins automatically use logged-in name, only admins can switch
  if ((!currentExecutive && !user?.executiveName) || (isSwitchingUser && isSheetAdmin)) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <ExecutiveAuthModal
          currentExecutive={currentExecutive || (user?.executiveName as PortalExecutive) || null}
          onSelect={handleSelectExecutive}
          onClose={() => setIsSwitchingUser(false)}
        />
      </main>
    );
  }

  const activeExec = currentExecutive || (user?.executiveName as PortalExecutive) || "Aman";
  const isAdmin = activeExec === "Aman" || isSheetAdmin;

  const navigationItems: Array<{
    key: TabKey;
    label: string;
    icon: React.ReactNode;
    adminOnly?: boolean;
  }> = [
    { key: "live", label: "Live Portal Status", icon: <Activity className="h-4 w-4" /> },
    { key: "schedule", label: "Executive Schedule", icon: <Calendar className="h-4 w-4" /> },
    { key: "session", label: "Start Session / Logout", icon: <LogIn className="h-4 w-4" /> },
    {
      key: "complaints",
      label: "Complaints & Queries",
      icon: <MessageSquare className="h-4 w-4" />,
    },
    { key: "usageReports", label: "Usage Reports", icon: <BarChart3 className="h-4 w-4" /> },
    {
      key: "complaintReports",
      label: "Complaint Reports",
      icon: <FileCheck className="h-4 w-4" />,
    },
    {
      key: "adminSettings",
      label: "Admin Settings",
      icon: <Lock className="h-4 w-4" />,
      adminOnly: true,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-6 space-y-6">
      {/* Top Header & Executive Info Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Bank Portal Usage
            </h1>
            <Badge variant="outline" className="border-primary text-primary font-semibold text-xs">
              Accountability Module
            </Badge>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            Strict time slots, 7m 15s temporary access, dispute escalation, and disciplinary
            tracking.
          </p>
        </div>

        {/* Current User Pill & Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">Logged In As:</span>
            <span className="font-bold text-foreground flex items-center gap-1">
              {isAdmin && <ShieldCheck className="h-3.5 w-3.5 text-purple-600" />}
              {activeExec}
            </span>
          </div>

          {sheetConfig?.spreadsheetUrl && (
            <a
              href={sheetConfig.spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-900 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200 text-xs font-medium transition-colors"
              title="अलग Google स्प्रेडशीट (Dedicated Bank Portal Spreadsheet)"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
              <span>पोर्टल स्प्रेडशीट</span>
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          )}

          {isSheetAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSwitchUser}
              className="h-8 text-xs gap-1 font-medium"
            >
              <UserCheck className="h-3.5 w-3.5" />
              Switch Name
            </Button>
          )}
        </div>
      </div>

      {/* Navigation Sub-Menu Bar */}
      <nav className="flex flex-wrap gap-1.5 border-b pb-3">
        {navigationItems.map((item) => {
          if (item.adminOnly && !isAdmin) return null;
          const isActive = activeTab === item.key;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveTab(item.key)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-semibold transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Access Request Banner for all tabs */}
      <AccessRequestBanner currentExecutive={activeExec} />

      {/* Tab Views */}
      {activeTab === "live" && (
        <div className="space-y-6">
          <LivePortalStatusBanner />
          <StartEndSessionCard currentExecutive={activeExec} adminPassword={adminPassword} />
          <ExecutiveScheduleView currentExecutive={activeExec} adminPassword={adminPassword} />
        </div>
      )}

      {activeTab === "schedule" && (
        <div className="space-y-6">
          <ExecutiveScheduleView currentExecutive={activeExec} adminPassword={adminPassword} />
        </div>
      )}

      {activeTab === "session" && (
        <div className="space-y-6">
          <LivePortalStatusBanner />
          <StartEndSessionCard currentExecutive={activeExec} adminPassword={adminPassword} />
        </div>
      )}

      {activeTab === "complaints" && (
        <div className="space-y-6">
          <ComplaintsAndQueriesSection
            currentExecutive={activeExec}
            adminPassword={adminPassword}
          />
        </div>
      )}

      {activeTab === "usageReports" && (
        <div className="space-y-6">
          <UsageReportsView />
        </div>
      )}

      {activeTab === "complaintReports" && (
        <div className="space-y-6">
          <ComplaintReportsView />
        </div>
      )}

      {activeTab === "adminSettings" && isAdmin && (
        <div className="space-y-6">
          <AdminSettingsView currentExecutive={activeExec} adminPassword={adminPassword} />
        </div>
      )}

      {/* Bottom Complaints & Queries Section as requested in Requirement #7: "Place the Complaints & Queries section at the bottom of the Bank Portal Usage page." */}
      {activeTab !== "complaints" &&
        activeTab !== "usageReports" &&
        activeTab !== "complaintReports" && (
          <div className="border-t pt-8">
            <ComplaintsAndQueriesSection
              currentExecutive={activeExec}
              adminPassword={adminPassword}
            />
          </div>
        )}
    </main>
  );
}
