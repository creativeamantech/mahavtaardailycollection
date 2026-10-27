import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  sheetListUsersAction,
  sheetAddUserAction,
  sheetUpdateUserStatusAction,
  sheetUpdateUserRoleAction,
  sheetResetPinAction,
  sheetGetUsersTabStatusAction,
} from "@/lib/sheet-auth.functions";
import type { SheetUserSafe } from "@/lib/sheet-auth.server";
import { getStoredSettingsPassword } from "@/components/PasswordGate";
import { getStoredSheetToken } from "@/hooks/useSheetAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  UserCheck,
  Users,
} from "lucide-react";

export function SheetUserManager() {
  const qc = useQueryClient();
  const listUsersFn = useServerFn(sheetListUsersAction);
  const addUserFn = useServerFn(sheetAddUserAction);
  const updateStatusFn = useServerFn(sheetUpdateUserStatusAction);
  const updateRoleFn = useServerFn(sheetUpdateUserRoleAction);
  const resetPinFn = useServerFn(sheetResetPinAction);
  const tabStatusFn = useServerFn(sheetGetUsersTabStatusAction);

  const [searchTerm, setSearchTerm] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  // New user state
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newRole, setNewRole] = useState<"Admin" | "Executive">("Executive");
  const [newStatus, setNewStatus] = useState<"Active" | "Inactive">("Active");
  const [submittingUser, setSubmittingUser] = useState(false);

  // Reset PIN modal/state
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [resetPinValue, setResetPinValue] = useState("");
  const [savingPin, setSavingPin] = useState(false);

  const getAuthPayload = () => ({
    token: getStoredSheetToken() || undefined,
    password: getStoredSettingsPassword() || undefined,
  });

  const {
    data: users = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery<SheetUserSafe[]>({
    queryKey: ["sheet-users"],
    queryFn: async () => {
      const res = await listUsersFn({ data: getAuthPayload() });
      return res.users || [];
    },
    staleTime: 10_000,
  });

  const {
    data: tabStatus,
    refetch: refetchTabStatus,
    isFetching: isCheckingTab,
  } = useQuery({
    queryKey: ["sheet-users-tab-status"],
    queryFn: async () => {
      return await tabStatusFn();
    },
    staleTime: 15_000,
  });

  const [showPasteGuide, setShowPasteGuide] = useState(false);

  const filteredUsers = useMemo(() => {
    if (!searchTerm.trim()) return users;
    const term = searchTerm.toLowerCase();
    return users.filter(
      (u) =>
        u.executiveName.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term) ||
        u.userId.toLowerCase().includes(term),
    );
  }, [users, searchTerm]);

  async function handleRefreshAll() {
    await Promise.all([refetch(), refetchTabStatus()]);
    toast.success("Synchronized with Google Sheet.");
  }

  async function handleCopyTsv(useHashed = false) {
    const content = useHashed ? tabStatus?.hashedTsv || tabStatus?.tsv : tabStatus?.tsv;
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      toast.success(
        "Copied Users table! Open your Daily Collection Sheet, create a 'Users' tab, and paste into cell A1.",
      );
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  }

  function handleDownloadCsv() {
    if (!tabStatus?.csv) return;
    const blob = new Blob([tabStatus.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Users.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Downloaded Users.csv for Google Sheets import.");
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim() || !newPin.trim()) {
      toast.error("Please fill in executive name, email, and PIN.");
      return;
    }
    if (newPin.trim().length < 4) {
      toast.error("PIN must be at least 4 digits.");
      return;
    }

    setSubmittingUser(true);
    try {
      await addUserFn({
        data: {
          ...getAuthPayload(),
          executiveName: newName.trim(),
          email: newEmail.trim().toLowerCase(),
          pin: newPin.trim(),
          role: newRole,
          status: newStatus,
        },
      });

      toast.success(`User "${newName.trim()}" added.`);
      setNewName("");
      setNewEmail("");
      setNewPin("");
      setShowAddForm(false);
      await qc.invalidateQueries({ queryKey: ["sheet-users"] });
      await qc.invalidateQueries({ queryKey: ["sheet-users-tab-status"] });
      await qc.invalidateQueries({ queryKey: ["sheet-login-options"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add user.");
    } finally {
      setSubmittingUser(false);
    }
  }

  async function handleToggleStatus(user: SheetUserSafe) {
    const nextStatus = user.status === "Active" ? "Inactive" : "Active";
    try {
      await updateStatusFn({
        data: {
          ...getAuthPayload(),
          userId: user.userId,
          status: nextStatus,
        },
      });
      toast.success(`${user.executiveName} marked as ${nextStatus}.`);
      await qc.invalidateQueries({ queryKey: ["sheet-users"] });
      await qc.invalidateQueries({ queryKey: ["sheet-users-tab-status"] });
      await qc.invalidateQueries({ queryKey: ["sheet-login-options"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update status.");
    }
  }

  async function handleToggleRole(user: SheetUserSafe) {
    const nextRole = user.role === "Admin" ? "Executive" : "Admin";
    try {
      await updateRoleFn({
        data: {
          ...getAuthPayload(),
          userId: user.userId,
          role: nextRole,
        },
      });
      toast.success(`${user.executiveName} role changed to ${nextRole}.`);
      await qc.invalidateQueries({ queryKey: ["sheet-users"] });
      await qc.invalidateQueries({ queryKey: ["sheet-users-tab-status"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to change role.");
    }
  }

  async function handleResetPin(userId: string) {
    if (!resetPinValue.trim() || resetPinValue.trim().length < 4) {
      toast.error("PIN must be at least 4 digits.");
      return;
    }

    setSavingPin(true);
    try {
      await resetPinFn({
        data: {
          ...getAuthPayload(),
          userId,
          newPin: resetPinValue.trim(),
        },
      });
      toast.success("Security PIN updated and hashed.");
      setResettingUserId(null);
      setResetPinValue("");
      await qc.invalidateQueries({ queryKey: ["sheet-users-tab-status"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reset PIN.");
    } finally {
      setSavingPin(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border p-5 bg-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">
              Google Sheet Users & PIN Authentication
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Synchronized with the <strong>Users</strong> tab (User_ID, Executive_Name, Email,
            PIN_Hash, Role, Status) in the Daily Collection sheet.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={isFetching || isCheckingTab}
            className="h-9 gap-1.5"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetching || isCheckingTab ? "animate-spin" : ""}`}
            />
            Refresh Sheet
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            className="h-9 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {showAddForm ? "Cancel" : "Add User"}
          </Button>
        </div>
      </div>

      {/* Google Sheet 'Users' Tab Status & 1-Click Sync Helper */}
      {tabStatus && (
        <div
          className={`rounded-lg border p-3.5 text-xs space-y-3 ${
            tabStatus.isPresentInGoogleSheet
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/40 bg-amber-500/10"
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                {tabStatus.isPresentInGoogleSheet ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Google Sheet &ldquo;Users&rdquo; Tab Connected</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>
                      &ldquo;Users&rdquo; Tab Setup for Daily Collection Sheet (Active Store Ready)
                    </span>
                  </>
                )}
              </div>
              {tabStatus.isPresentInGoogleSheet ? (
                <p className="text-muted-foreground">
                  The <strong>Users</strong> tab is live in your Daily Collection Google Sheet. Both
                  plain 4-digit PINs (e.g. <code>0003</code>, <code>1234</code>) and hashed PINs
                  work automatically.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Open your Daily Collection Google Sheet, add a new tab named{" "}
                  <code className="rounded bg-background px-1 py-0.5 font-mono font-semibold">
                    Users
                  </code>
                  , click <strong>Copy Table</strong> below, and paste (
                  <kbd className="rounded border bg-background px-1">Ctrl+V</kbd>) directly into
                  Cell <strong>A1</strong>.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => handleCopyTsv(false)}
                className="h-8 text-xs gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy Table
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadCsv}
                className="h-8 text-xs gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Download Users.csv
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowPasteGuide((v) => !v)}
                className="h-8 text-xs"
              >
                {showPasteGuide ? "Hide TSV Data" : "View Ready-to-Paste TSV"}
              </Button>
              <a
                href={tabStatus.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-accent transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open Google Sheet
              </a>
            </div>
          </div>

          {showPasteGuide && (
            <div className="rounded-md border bg-background p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-xs">
                  Ready-to-Paste Data (Copy and paste directly into Cell A1 of{" "}
                  <code className="font-mono">Users</code> tab):
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyTsv(false)}
                    className="h-7 text-[11px] gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    Copy Plain PIN Table
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyTsv(true)}
                    className="h-7 text-[11px] gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    Copy Scrypt-Hashed Table
                  </Button>
                </div>
              </div>
              <pre className="overflow-x-auto rounded bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed select-all">
                {tabStatus.tsv}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Add User Form */}
      {showAddForm && (
        <form
          onSubmit={handleAddUser}
          className="rounded-lg border bg-muted/40 p-4 space-y-4 animate-in fade-in duration-200"
        >
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <UserCheck className="h-4 w-4 text-primary" />
            Add New User to Google Sheet
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="new-name" className="text-xs font-medium">
                Executive Name
              </Label>
              <Input
                id="new-name"
                placeholder="e.g. Rahul"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-email" className="text-xs font-medium">
                Email Address
              </Label>
              <Input
                id="new-email"
                type="email"
                placeholder="e.g. rahul@mahavtaar.in"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-pin" className="text-xs font-medium">
                Initial Security PIN (min 4 digits)
              </Label>
              <Input
                id="new-pin"
                type="password"
                placeholder="e.g. 1234"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                required
                maxLength={8}
                className="h-9 text-sm font-mono tracking-widest"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="new-role" className="text-xs font-medium">
                  Role
                </Label>
                <select
                  id="new-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "Admin" | "Executive")}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="Executive">Executive</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-status" className="text-xs font-medium">
                  Status
                </Label>
                <select
                  id="new-status"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as "Active" | "Inactive")}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submittingUser}>
              {submittingUser ? "Saving to Sheet..." : "Add to Google Sheet"}
            </Button>
          </div>
        </form>
      )}

      {/* Search & Filter */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search by executive name, email, or user ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-9 pl-9 pr-3 text-sm"
        />
      </div>

      {/* Users List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading users from Google Sheet...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No users found matching query.
          </div>
        ) : (
          filteredUsers.map((user) => {
            const isResetting = resettingUserId === user.userId;

            return (
              <div
                key={user.userId}
                className="flex flex-col gap-2 rounded-lg border p-3 bg-card hover:bg-muted/20 transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{user.executiveName}</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        ({user.userId})
                      </span>
                      <Badge
                        variant={user.role === "Admin" ? "default" : "secondary"}
                        className="text-[11px] cursor-pointer"
                        onClick={() => handleToggleRole(user)}
                        title="Click to toggle Role"
                      >
                        {user.role}
                      </Badge>
                      <Badge
                        variant={user.status === "Active" ? "outline" : "destructive"}
                        className={`text-[11px] cursor-pointer ${
                          user.status === "Active"
                            ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                            : ""
                        }`}
                        onClick={() => handleToggleStatus(user)}
                        title="Click to toggle Status"
                      >
                        {user.status === "Active" ? (
                          <span className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                            Inactive
                          </span>
                        )}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleStatus(user)}
                      className="h-8 text-xs"
                    >
                      {user.status === "Active" ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setResettingUserId(isResetting ? null : user.userId);
                        setResetPinValue("");
                      }}
                      className="h-8 text-xs gap-1"
                    >
                      <KeyRound className="h-3 w-3" />
                      Reset PIN
                    </Button>
                  </div>
                </div>

                {/* Inline PIN Reset */}
                {isResetting && (
                  <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/50 p-2.5 animate-in fade-in duration-150">
                    <span className="text-xs font-medium shrink-0">New PIN:</span>
                    <Input
                      type="password"
                      maxLength={8}
                      placeholder="e.g. 5678"
                      value={resetPinValue}
                      onChange={(e) => setResetPinValue(e.target.value)}
                      className="h-8 max-w-[130px] text-xs font-mono tracking-widest"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingPin || resetPinValue.trim().length < 4}
                      onClick={() => handleResetPin(user.userId)}
                      className="h-8 text-xs"
                    >
                      {savingPin ? "Hashing..." : "Save PIN"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setResettingUserId(null)}
                      className="h-8 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="pt-1 text-[11px] text-muted-foreground">
        Note: PINs are hashed using salt + scrypt and never stored or returned in plaintext.
        Administrators can also directly edit the <strong>Users</strong> sheet in Google Drive.
      </div>
    </section>
  );
}
