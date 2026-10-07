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
import { PasswordGate, SETTINGS_SESSION_KEY as SESSION_KEY } from "@/components/PasswordGate";
import { NotificationPanel } from "@/components/NotificationPanel";
import { ALL_CATEGORIES, uniqueCategories } from "@/components/AllocationFilters";
import { getCollections } from "@/lib/mahavtaar.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

function SettingsContent() {
  const qc = useQueryClient();
  const { flags, notifications, defaultCategory, isLoading } = useAppConfig();
  const saveFlags = useServerFn(saveFeatureFlags);
  const saveDefaultCat = useServerFn(saveDefaultCategory);
  const addNotif = useServerFn(addNotification);
  const removeNotif = useServerFn(removeNotification);
  const fetchCollections = useServerFn(getCollections);

  const { data: collectionsData } = useQuery({
    queryKey: ["collections"],
    queryFn: () => fetchCollections(),
    staleTime: 5 * 60 * 1000,
  });

  const detectedCategories = useMemo(
    () => uniqueCategories(collectionsData ?? []),
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
  const [image, setImage] = useState<{ name: string; mimeType: string; base64: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const activeNotifications = notifications.filter((n) => n.status.toLowerCase() !== "removed");

  async function handleSaveCategory(category: string) {
    const categoryToSave = category === ALL_CATEGORIES ? "" : category.trim();
    setSavingCategory(true);
    qc.setQueryData(APP_CONFIG_KEY, (old: unknown) =>
      old ? { ...(old as object), defaultCategory: categoryToSave } : old,
    );
    try {
      await saveDefaultCat({ data: { category: categoryToSave } });
      toast.success(
        categoryToSave
          ? `Default allocation category saved: "${categoryToSave}"`
          : "Default allocation category set to All Categories",
      );
      setIsCustomCategory(false);
      setCustomCategoryInput("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save default category");
      await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
    } finally {
      setSavingCategory(false);
    }
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
