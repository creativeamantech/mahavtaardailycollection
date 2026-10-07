import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  FEATURES,
  addNotification,
  getConnectionInfo,
  removeNotification,
  saveFeatureFlags,
  verifySettingsPassword,
} from "@/lib/app-config.functions";
import { APP_CONFIG_KEY, useAppConfig } from "@/hooks/useAppConfig";
import { NotificationPanel } from "@/components/NotificationPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/settings")({
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

const SESSION_KEY = "mahavtaar-settings-unlocked";

function SettingsPage() {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === "1") setUnlocked(true);
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      {unlocked ? (
        <SettingsContent />
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

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const verify = useServerFn(verifySettingsPassword);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const res = await verify({ data: { password } });
          if (res.ok) onUnlock();
          else setError("Incorrect password");
        } catch {
          setError("Incorrect password");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Label className="text-base" htmlFor="settings-password">
        Enter settings password
      </Label>
      <Input
        id="settings-password"
        type="password"
        autoComplete="off"
        className="h-12 text-base"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error !== "" && <p className="text-sm font-medium text-destructive">{error}</p>}
      <Button type="submit" className="h-12 w-full text-base" disabled={busy}>
        {busy ? "Checking…" : "Unlock Settings"}
      </Button>
    </form>
  );
}

function SettingsContent() {
  const qc = useQueryClient();
  const { flags, notifications, isLoading } = useAppConfig();
  const saveFlags = useServerFn(saveFeatureFlags);
  const addNotif = useServerFn(addNotification);
  const removeNotif = useServerFn(removeNotification);
  const fetchConn = useServerFn(getConnectionInfo);

  const { data: conn } = useQuery({
    queryKey: ["connection-info"],
    queryFn: () => fetchConn(),
    staleTime: 60_000,
  });

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ name: string; mimeType: string; base64: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const activeNotifications = notifications.filter((n) => n.status.toLowerCase() !== "removed");

  async function toggle(key: string, value: boolean) {
    const next = { ...flags, [key]: value };
    setSavingKey(key);
    qc.setQueryData(APP_CONFIG_KEY, (old: unknown) =>
      old ? { ...(old as object), flags: next } : old,
    );
    try {
      await saveFlags({ data: { flags: next } });
    } catch (e) {
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
        <h2 className="text-lg font-semibold">Google Drive &amp; Google Sheets Connection</h2>
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Integration Source</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Connected via Connectors
            </span>
          </div>

          <div className="grid gap-3 pt-1">
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Google Sheets (Database File)</p>
                  <p className="truncate text-xs font-mono text-muted-foreground mt-0.5">
                    {conn?.spreadsheetId ?? "1AXLakW3subO9H-O9iWIpXJyjT4JLXRTG5uiL3dWsY5g"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tabs: Collections, Pending, ECS_Special_Info, AppSettings, Notifications
                  </p>
                </div>
                <a
                  href={
                    conn?.spreadsheetUrl ??
                    "https://docs.google.com/spreadsheets/d/1AXLakW3subO9H-O9iWIpXJyjT4JLXRTG5uiL3dWsY5g/edit"
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs font-medium text-primary underline"
                >
                  Open Sheet ↗
                </a>
              </div>
              <div className="mt-3 rounded-md border border-blue-200 bg-blue-50/60 p-2.5 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                <p className="font-semibold">To load live data into this app:</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                  <li>
                    Click <strong>Open Sheet ↗</strong> above to open your Google Spreadsheet.
                  </li>
                  <li>
                    Click <strong>Share</strong> in the top right of Google Sheets.
                  </li>
                  <li>
                    Under <em>General access</em>, change to <strong>"Anyone with the link"</strong>{" "}
                    (Viewer).
                  </li>
                  <li>
                    Return here and tap <strong>Refresh</strong> on Report or Loan Details!
                  </li>
                </ol>
              </div>
            </div>

            <div className="rounded-md border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Google Drive (Attachments Folder)</p>
                  <p className="truncate text-xs font-mono text-muted-foreground mt-0.5">
                    {conn?.driveFolderId ?? "1iBlXqe09aG5kA_hHf3WtFILnA1RibCf7"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Payment Receipts, Slips &amp; Notification Attachments
                  </p>
                </div>
                <a
                  href={
                    conn?.driveFolderUrl ??
                    "https://drive.google.com/drive/folders/1iBlXqe09aG5kA_hHf3WtFILnA1RibCf7"
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs font-medium text-primary underline"
                >
                  Open Folder ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

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
            disabled={saving || text.trim() === ""}
            onClick={async () => {
              setSaving(true);
              try {
                await addNotif({
                  data: { text: text.trim(), ...(image ? { image } : {}) },
                });
                setText("");
                setImage(null);
                await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
                toast.success("Notification published");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not save notification");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save Notification"}
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
                    await removeNotif({ data: { id: n.id } });
                    await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
                    toast.success("Notification removed");
                  } catch (e) {
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
