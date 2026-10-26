import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  FEATURES,
  addNotification,
  removeNotification,
  saveDefaultCategory,
  saveFeatureFlags,
} from "@/lib/app-config.functions";
import { APP_CONFIG_KEY, useAppConfig } from "@/hooks/useAppConfig";
import {
  PasswordGate,
  SETTINGS_SESSION_KEY as SESSION_KEY,
  getStoredSettingsPassword,
  clearStoredSettingsPassword,
} from "@/components/PasswordGate";
import { NotificationPanel } from "@/components/NotificationPanel";
import { ALL_CATEGORIES, uniqueCategories } from "@/components/AllocationFilters";
import { getCollections } from "@/lib/mahavtaar.functions";
import {
  getApprovedEmails,
  addApprovedEmailAction,
  removeApprovedEmailAction,
} from "@/lib/auth-allowlist.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, Plus, RefreshCw, Search, Trash2, UserCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Mahavtaar Daily Collection" },
      {
        name: "description",
        content: "Protected settings to control page visibility and publish app notifications.",
      },
      { property: "og:title", content: "Settings — Mahavtaar Daily Collection" },
      {
        property: "og:description",
        content: "Control page visibility and manage notifications for the collection app.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === "1") setUnlocked(true);
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      {unlocked ? (
        <SettingsContent
          onRelock={() => {
            clearStoredSettingsPassword();
            setUnlocked(false);
          }}
        />
      ) : (
        <PasswordGate
          onUnlock={() => {
            sessionStorage.setItem(SESSION_KEY, "1");
            setUnlocked(true);
          }}
        />
      )}
    </main>
  );
}

function SettingsContent({ onRelock }: { onRelock: () => void }) {
  const qc = useQueryClient();
  const { flags, notifications, defaultCategory, isLoading } = useAppConfig();
  const saveFlags = useServerFn(saveFeatureFlags);
  const saveDefaultCat = useServerFn(saveDefaultCategory);
  const addNotif = useServerFn(addNotification);
  const removeNotif = useServerFn(removeNotification);
  const fetchCollections = useServerFn(getCollections);

  const { data: collectionsData } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const res = await fetchCollections();
      return Array.isArray(res) ? res : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const detectedCategories = useMemo(
    () => uniqueCategories(Array.isArray(collectionsData) ? collectionsData : []),
    [collectionsData],
  );

  const categoryOptions = useMemo(() => {
    const set = new Set(detectedCategories);
    if (defaultCategory && defaultCategory !== ALL_CATEGORIES) {
      set.add(defaultCategory);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [detectedCategories, defaultCategory]);

  const [savingCategory, setSavingCategory] = useState(false);
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryInput, setCustomCategoryInput] = useState("");

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [savingNotif, setSavingNotif] = useState(false);
  const [image, setImage] = useState<{ name: string; mimeType: string; base64: string } | null>(
    null,
  );
  const activeNotifications = notifications.filter((n) => n.status.toLowerCase() !== "removed");

  const fetchApprovedEmails = useServerFn(getApprovedEmails);
  const addApprovedEmailFn = useServerFn(addApprovedEmailAction);
  const removeApprovedEmailFn = useServerFn(removeApprovedEmailAction);

  const {
    data: approvedEmailsList = [],
    refetch: refetchApprovedEmails,
    isLoading: loadingApprovedEmails,
  } = useQuery({
    queryKey: ["approvedEmails"],
    queryFn: async () => {
      const res = await fetchApprovedEmails({
        data: { password: getStoredSettingsPassword() },
      });
      return res.emails ?? [];
    },
    staleTime: 30_000,
  });

  const [newEmail, setNewEmail] = useState("");
  const [addingEmail, setAddingEmail] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [emailSearchTerm, setEmailSearchTerm] = useState("");

  const filteredApprovedEmails = useMemo(() => {
    if (!emailSearchTerm.trim()) return approvedEmailsList;
    const term = emailSearchTerm.toLowerCase();
    return approvedEmailsList.filter((item) => item.email.toLowerCase().includes(term));
  }, [approvedEmailsList, emailSearchTerm]);

  async function handleAddEmail(e: React.FormEvent) {
    e.preventDefault();
    const mail = newEmail.trim().toLowerCase();
    if (!mail || !mail.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }

    setAddingEmail(true);
    try {
      const res = await addApprovedEmailFn({
        data: {
          password: getStoredSettingsPassword(),
          email: mail,
        },
      });
      toast.success(res.message);
      setNewEmail("");
      await refetchApprovedEmails();
    } catch (err) {
      if (relockOnAuthFailure(err)) return;
      toast.error(err instanceof Error ? err.message : "Failed to add approved email");
    } finally {
      setAddingEmail(false);
    }
  }

  async function handleRemoveEmail(emailToRemove: string) {
    if (
      !window.confirm(
        `Are you sure you want to remove "${emailToRemove}" from the approved sign-up list? This email will no longer be eligible to create an account.`,
      )
    ) {
      return;
    }

    setRemovingEmail(emailToRemove);
    try {
      const res = await removeApprovedEmailFn({
        data: {
          password: getStoredSettingsPassword(),
          email: emailToRemove,
        },
      });
      toast.success(res.message);
      await refetchApprovedEmails();
    } catch (err) {
      if (relockOnAuthFailure(err)) return;
      toast.error(err instanceof Error ? err.message : "Failed to remove approved email");
    } finally {
      setRemovingEmail(null);
    }
  }

  async function handleSaveCategory(category: string) {
    const categoryToSave = category === ALL_CATEGORIES ? "" : category.trim();
    setSavingCategory(true);
    qc.setQueryData(APP_CONFIG_KEY, (old: unknown) =>
      old ? { ...(old as object), defaultCategory: categoryToSave } : old,
    );
    try {
      await saveDefaultCat({
        data: { password: getStoredSettingsPassword(), category: categoryToSave },
      });
      toast.success(
        categoryToSave
          ? `Default allocation category saved: "${categoryToSave}"`
          : "Default allocation category set to All Categories",
      );
      setIsCustomCategory(false);
      setCustomCategoryInput("");
    } catch (e) {
      if (relockOnAuthFailure(e)) return;
      toast.error(e instanceof Error ? e.message : "Could not save default category");
      await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
    } finally {
      setSavingCategory(false);
    }
  }

  // If the server rejects the stored password, lock the page again so the
  // user can re-enter it instead of failing on every action.
  function relockOnAuthFailure(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : "";
    if (!/incorrect password|unauthorized/i.test(msg)) return false;
    onRelock();
    toast.error("Password session expired. Please enter the password again.");
    return true;
  }

  function handleSelectCategoryChange(val: string) {
    if (val === "__custom__") {
      setIsCustomCategory(true);
      return;
    }
    setIsCustomCategory(false);
    void handleSaveCategory(val);
  }

  async function toggle(key: string, value: boolean) {
    const next = { ...flags, [key]: value };
    setSavingKey(key);
    qc.setQueryData(APP_CONFIG_KEY, (old: unknown) =>
      old ? { ...(old as object), flags: next } : old,
    );
    try {
      await saveFlags({ data: { password: getStoredSettingsPassword(), flags: next } });
    } catch (e) {
      if (relockOnAuthFailure(e)) return;
      toast.error(e instanceof Error ? e.message : "Could not save setting");
      await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
    } finally {
      setSavingKey(null);
    }
  }

  async function pickImage(file: File | null) {
    if (!file) {
      setImage(null);
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("Could not read the image."));
      reader.readAsDataURL(file);
    });
    setImage({ name: file.name, mimeType: file.type || "image/jpeg", base64 });
  }

  return (
    <div className="space-y-8">
      <NotificationPanel />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Page &amp; Feature Visibility</h2>
        <div className="divide-y rounded-lg border">
          {FEATURES.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-base font-medium">{f.label}</p>
                <p className="text-xs text-muted-foreground">
                  {f.path ? f.path : "Shown inside Payment Entry"}
                </p>
              </div>
              <Switch
                checked={flags[f.key] !== false}
                disabled={isLoading || savingKey === f.key}
                onCheckedChange={(v) => toggle(f.key, v)}
                aria-label={`Toggle ${f.label}`}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Default Allocation Category</h2>
          <p className="text-sm text-muted-foreground">
            Sets the starting category filter for Report, Loan Details, and Already Paid. Users can
            still change the filter on any screen during their session.
          </p>
        </div>
        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-2">
            <Label className="text-base" htmlFor="default-allocation-category">
              Select Starting Category
            </Label>
            <Select
              value={isCustomCategory ? "__custom__" : defaultCategory || ALL_CATEGORIES}
              onValueChange={handleSelectCategoryChange}
              disabled={isLoading || savingCategory}
            >
              <SelectTrigger id="default-allocation-category" className="h-12 text-base">
                <SelectValue placeholder="Choose default category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CATEGORIES} className="text-base">
                  All Categories (No filter)
                </SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c} className="text-base">
                    {c}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__" className="text-base font-medium text-primary">
                  + Custom / New Category…
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isCustomCategory && (
            <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-3">
              <Label className="text-sm font-medium" htmlFor="custom-category-name">
                Enter Custom Category Name
              </Label>
              <div className="flex gap-2">
                <Input
                  id="custom-category-name"
                  className="h-12 text-base"
                  placeholder="e.g. Retail, SME, Corporate"
                  value={customCategoryInput}
                  onChange={(e) => setCustomCategoryInput(e.target.value)}
                  maxLength={80}
                  disabled={savingCategory}
                />
                <Button
                  className="h-12 shrink-0 px-5 text-base"
                  disabled={savingCategory || customCategoryInput.trim() === ""}
                  onClick={() => void handleSaveCategory(customCategoryInput.trim())}
                >
                  {savingCategory ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="outline"
                  className="h-12 shrink-0 text-base"
                  disabled={savingCategory}
                  onClick={() => {
                    setIsCustomCategory(false);
                    setCustomCategoryInput("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm text-muted-foreground">
            <span>
              Active Default:{" "}
              <strong className="text-foreground">
                {defaultCategory ? defaultCategory : "All Categories"}
              </strong>
            </span>
            {savingCategory && <span className="font-medium text-primary">Saving changes…</span>}
          </div>
        </div>
      </section>

      {/* Approved Sign-up Emails Section */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-primary" />
                Approved Sign-up Emails
              </h2>
              <Badge variant="secondary" className="text-xs font-semibold">
                {approvedEmailsList.length} Approved
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Only emails listed here are allowed to register for an account on the sign-up page.
              Protected by the Settings password.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetchApprovedEmails()}
            className="h-9 gap-1.5 text-xs"
            disabled={loadingApprovedEmails}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingApprovedEmails ? "animate-spin" : ""}`} />
            Refresh List
          </Button>
        </div>

        {/* Add Email Form */}
        <form
          onSubmit={handleAddEmail}
          className="space-y-3 rounded-xl border bg-card p-4 shadow-sm"
        >
          <Label className="text-sm font-semibold" htmlFor="new-approved-email">
            Add New Approved Email
          </Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="new-approved-email"
                type="email"
                placeholder="colleague@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="h-11 pl-9 text-sm"
                disabled={addingEmail}
                required
              />
            </div>
            <Button
              type="submit"
              disabled={addingEmail || !newEmail.trim()}
              className="h-11 px-5 gap-1.5 shrink-0 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              {addingEmail ? "Adding…" : "Add Email"}
            </Button>
          </div>
        </form>

        {/* Search & List of Approved Emails */}
        <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
            <div className="text-sm font-semibold">Approved Email Allowlist</div>
            {approvedEmailsList.length > 3 && (
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter emails…"
                  value={emailSearchTerm}
                  onChange={(e) => setEmailSearchTerm(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            )}
          </div>

          {loadingApprovedEmails ? (
            <p className="py-6 text-center text-sm text-muted-foreground animate-pulse">
              Loading approved emails…
            </p>
          ) : filteredApprovedEmails.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {emailSearchTerm
                ? `No approved emails match "${emailSearchTerm}".`
                : "No approved emails found. Add an email above to authorize account creation."}
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {filteredApprovedEmails.map((item) => (
                <div
                  key={item.email}
                  className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-muted/30 transition-colors"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-mono text-sm font-medium truncate text-foreground">
                      {item.email}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Added:{" "}
                      {new Date(item.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removingEmail === item.email}
                    onClick={() => void handleRemoveEmail(item.email)}
                    className="h-8 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0 gap-1"
                    title={`Remove ${item.email}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{removingEmail === item.email ? "Removing…" : "Remove"}</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Notification Management</h2>
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-2">
            <Label className="text-base" htmlFor="notif-text">
              Notification text
            </Label>
            <Textarea
              id="notif-text"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message to show across the app"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-base" htmlFor="notif-image">
              Image (optional)
            </Label>
            <Input
              id="notif-image"
              type="file"
              accept="image/*"
              className="h-12 text-base"
              onChange={(e) => void pickImage(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            className="h-12 w-full text-base"
            disabled={savingNotif || text.trim() === ""}
            onClick={async () => {
              setSavingNotif(true);
              try {
                await addNotif({
                  data: {
                    password: getStoredSettingsPassword(),
                    text: text.trim(),
                    ...(image ? { image } : {}),
                  },
                });
                setText("");
                setImage(null);
                await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
                toast.success("Notification published");
              } catch (e) {
                if (relockOnAuthFailure(e)) return;
                toast.error(e instanceof Error ? e.message : "Could not save notification");
              } finally {
                setSavingNotif(false);
              }
            }}
          >
            {savingNotif ? "Saving…" : "Save Notification"}
          </Button>
        </div>

        <div className="space-y-2">
          {activeNotifications.length === 0 && (
            <p className="text-sm text-muted-foreground">No active notifications.</p>
          )}
          {[...activeNotifications].reverse().map((n) => (
            <div
              key={n.id}
              className="flex items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="break-words text-sm">{n.text}</p>
                {n.imageUrl !== "" && (
                  <a
                    href={n.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline"
                  >
                    Image
                  </a>
                )}
              </div>
              <Button
                variant="outline"
                className="shrink-0"
                onClick={async () => {
                  try {
                    await removeNotif({
                      data: { password: getStoredSettingsPassword(), id: n.id },
                    });
                    await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
                    toast.success("Notification removed");
                  } catch (e) {
                    if (relockOnAuthFailure(e)) return;
                    toast.error(e instanceof Error ? e.message : "Could not remove");
                  }
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
