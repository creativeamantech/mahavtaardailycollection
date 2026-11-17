import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  FEATURES,
  addNotification,
  removeNotification,
  saveDefaultCategory,
  saveDefaultAllocationType,
  saveFeatureFlags,
  saveHoldCasesLock,
} from "@/lib/app-config.functions";
import { APP_CONFIG_KEY, useAppConfig } from "@/hooks/useAppConfig";
import { NotificationPanel } from "@/components/NotificationPanel";
import { MasterAllocationInitializer } from "@/components/MasterAllocationInitializer";
import {
  ALL_CATEGORIES,
  uniqueCategories,
  uniqueAllocationTypes,
  ALL_ALLOCATION_TYPES,
} from "@/components/AllocationFilters";
import { Bell, LayoutGrid, Lock, Settings, SlidersHorizontal } from "lucide-react";
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
  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-[0_4px_18px_rgba(40,20,94,0.038)] sm:p-5">
        <div className="mahavtaar-spectrum-bar absolute inset-x-0 top-0 h-[3px]" />
        <div className="flex items-center gap-3 pt-1">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#edd068] bg-[#fef8e2] text-[#28145e]">
            <Settings className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wider text-[#6e287f] uppercase">
              System Preferences
            </p>
            <h1 className="font-display text-xl font-bold tracking-tight text-[#28145e] sm:text-2xl">
              Settings
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              Manage access, features, default filters, and team notifications
            </p>
          </div>
        </div>
      </div>
      <MasterAllocationInitializer />
      <SettingsContent />
    </main>
  );
}

function SectionHeading({
  title,
  description,
  eyebrow,
}: {
  title: string;
  description?: string;
  eyebrow: string;
}) {
  const Icon =
    eyebrow === "ACCESS CONTROL"
      ? Lock
      : eyebrow === "APP ACCESS"
        ? LayoutGrid
        : eyebrow === "DEFAULT"
          ? SlidersHorizontal
          : Bell;

  return (
    <div className="mb-3 flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#edd068] bg-[#fef8e2] text-[#28145e]">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-base font-bold tracking-tight text-[#28145e] sm:text-lg">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {description}
          </p>
        )}
      </div>
      <span className="hidden shrink-0 pt-1 text-[10px] font-semibold tracking-wider text-[#6e287f] sm:block">
        {eyebrow}
      </span>
    </div>
  );
}

function SettingsContent() {
  const qc = useQueryClient();
  const {
    flags,
    notifications,
    defaultCategory,
    defaultAllocationType,
    holdCasesLocked,
    isLoading,
  } = useAppConfig();
  const saveFlags = useServerFn(saveFeatureFlags);
  const saveDefaultCat = useServerFn(saveDefaultCategory);
  const saveDefaultType = useServerFn(saveDefaultAllocationType);
  const saveHoldLock = useServerFn(saveHoldCasesLock);
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

  const detectedAllocationTypes = useMemo(
    () => uniqueAllocationTypes(Array.isArray(collectionsData) ? collectionsData : []),
    [collectionsData],
  );
  const allocationTypeOptions = useMemo(() => {
    const set = new Set(detectedAllocationTypes);
    if (defaultAllocationType) set.add(defaultAllocationType);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [detectedAllocationTypes, defaultAllocationType]);

  const categoryOptions = useMemo(() => {
    const set = new Set(detectedCategories);
    if (defaultCategory && defaultCategory !== ALL_CATEGORIES) {
      set.add(defaultCategory);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [detectedCategories, defaultCategory]);

  const [savingCategory, setSavingCategory] = useState(false);
  const [savingAllocationType, setSavingAllocationType] = useState(false);
  const [savingHoldLock, setSavingHoldLock] = useState(false);
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryInput, setCustomCategoryInput] = useState("");

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ name: string; mimeType: string; base64: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const activeNotifications = notifications.filter((n) => n.status.toLowerCase() !== "removed");

  async function handleToggleHoldLock(locked: boolean) {
    setSavingHoldLock(true);
    qc.setQueryData(APP_CONFIG_KEY, (old: unknown) =>
      old ? { ...(old as object), holdCasesLocked: locked } : old,
    );
    try {
      await saveHoldLock({ data: { locked } });
      toast.success(
        locked ? "Hold Cases locked for everyone." : "Hold Cases unlocked for everyone.",
      );
      await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update Hold Cases lock.");
      await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
    } finally {
      setSavingHoldLock(false);
    }
  }

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

  async function handleSaveAllocationType(allocationType: string) {
    const value = allocationType === ALL_ALLOCATION_TYPES ? "" : allocationType.trim();
    setSavingAllocationType(true);
    qc.setQueryData(APP_CONFIG_KEY, (old: unknown) =>
      old ? { ...(old as object), defaultAllocationType: value } : old,
    );
    try {
      await saveDefaultType({ data: { allocationType: value } });
      toast.success(
        value
          ? `Default allocation type saved: "${value}"`
          : "Default allocation type set to All Allocation Types",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save default allocation type");
      await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
    } finally {
      setSavingAllocationType(false);
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
    <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] lg:gap-6">
      <div className="lg:col-span-2">
        <NotificationPanel className="rounded-2xl border-[#edd068] bg-[#fef8e2]/60 p-4" />
      </div>

      <section className="order-2 rounded-2xl border border-border bg-card p-3 shadow-[0_4px_18px_rgba(40,20,94,0.038)] sm:p-4 lg:order-2 lg:col-start-2">
        <SectionHeading
          title="Hold Cases Access Lock"
          eyebrow="ACCESS CONTROL"
          description="When enabled, all executives are blocked from adding or manually removing Hold Cases. This setting applies globally to everyone."
        />
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3 sm:p-4">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#28145e]">
              {holdCasesLocked ? "Hold Cases Locked" : "Hold Cases Unlocked"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {holdCasesLocked
                ? "Nobody can add or remove cases."
                : "Executives can add and remove cases."}
            </p>
          </div>
          <Switch
            checked={holdCasesLocked}
            disabled={isLoading || savingHoldLock}
            onCheckedChange={(value) => void handleToggleHoldLock(value)}
            aria-label="Lock Hold Cases for everyone"
            className="shrink-0 data-[state=checked]:bg-primary"
          />
        </div>
      </section>

      <section className="order-1 rounded-2xl border border-border bg-card p-3 shadow-[0_4px_18px_rgba(40,20,94,0.038)] sm:p-4 lg:order-1 lg:col-start-1 lg:row-span-4">
        <SectionHeading
          title="Page & Feature Visibility"
          eyebrow="APP ACCESS"
          description="Choose which app pages and features are available to the team."
        />
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {FEATURES.map((f) => (
            <div
              key={f.key}
              className="flex min-h-[64px] items-center justify-between gap-3 bg-card px-3 py-3 transition-colors hover:bg-muted/35 sm:px-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{f.label}</p>
                <p className="mt-0.5 break-words text-[11px] text-muted-foreground sm:text-xs">
                  {f.path ? f.path : "Shown inside Payment Entry"}
                </p>
              </div>
              <Switch
                checked={flags[f.key] !== false}
                disabled={isLoading || savingKey === f.key}
                onCheckedChange={(v) => toggle(f.key, v)}
                aria-label={`Toggle ${f.label}`}
                className="shrink-0 data-[state=checked]:bg-primary"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="order-3 rounded-2xl border border-border bg-card p-3 shadow-[0_4px_18px_rgba(40,20,94,0.038)] sm:p-4 lg:order-3 lg:col-start-2">
        <SectionHeading
          title="Default Allocation Category"
          eyebrow="DEFAULT"
          description="Sets the starting category filter for Report, Loan Details, and Already Paid. Users can still change the filter on any screen during their session."
        />
        <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3 sm:p-4">
          <div className="space-y-2">
            <Label
              className="text-sm font-semibold text-foreground"
              htmlFor="default-allocation-category"
            >
              Select Starting Category
            </Label>
            <Select
              value={isCustomCategory ? "__custom__" : defaultCategory || ALL_CATEGORIES}
              onValueChange={handleSelectCategoryChange}
              disabled={isLoading || savingCategory}
            >
              <SelectTrigger
                id="default-allocation-category"
                className="h-12 rounded-xl border-border bg-card text-base focus:ring-ring"
              >
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
            <div className="space-y-2 rounded-xl border border-dashed border-[#edd068] bg-card p-3">
              <Label className="text-sm font-medium" htmlFor="custom-category-name">
                Enter Custom Category Name
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="custom-category-name"
                  className="h-12 min-w-0 rounded-xl border-border bg-card text-base"
                  placeholder="e.g. Retail, SME, Corporate"
                  value={customCategoryInput}
                  onChange={(e) => setCustomCategoryInput(e.target.value)}
                  maxLength={80}
                  disabled={savingCategory}
                />
                <div className="flex gap-2">
                  <Button
                    className="h-12 flex-1 bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-[#5d2172] sm:flex-none"
                    disabled={savingCategory || customCategoryInput.trim() === ""}
                    onClick={() => void handleSaveCategory(customCategoryInput.trim())}
                  >
                    {savingCategory ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 flex-1 rounded-xl border-border text-base sm:flex-none"
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
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:text-sm">
            <span>
              Active Default:{" "}
              <strong className="text-[#28145e]">
                {defaultCategory ? defaultCategory : "All Categories"}
              </strong>
            </span>
            {savingCategory && <span className="font-medium text-[#6e287f]">Saving changes…</span>}
          </div>
        </div>
      </section>

      <section className="order-4 rounded-2xl border border-border bg-card p-3 shadow-[0_4px_18px_rgba(40,20,94,0.038)] sm:p-4 lg:order-4 lg:col-start-2">
        <SectionHeading
          title="Default Allocation Type"
          eyebrow="DEFAULT"
          description="Sets the starting Allocation Type filter for reports and loan views. Options are read directly from the existing Collection Sheet."
        />
        <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3 sm:p-4">
          <div className="space-y-2">
            <Label
              className="text-sm font-semibold text-foreground"
              htmlFor="default-allocation-type"
            >
              Select Starting Allocation Type
            </Label>
            <Select
              value={defaultAllocationType || ALL_ALLOCATION_TYPES}
              onValueChange={(value) => void handleSaveAllocationType(value)}
              disabled={isLoading || savingAllocationType}
            >
              <SelectTrigger
                id="default-allocation-type"
                className="h-12 rounded-xl border-border bg-card text-base focus:ring-ring"
              >
                <SelectValue placeholder="Choose default allocation type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ALLOCATION_TYPES} className="text-base">
                  All Allocation Types
                </SelectItem>
                {allocationTypeOptions.map((value) => (
                  <SelectItem key={value} value={value} className="text-base">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:text-sm">
            <span>
              Active Default:{" "}
              <strong className="text-[#28145e]">
                {defaultAllocationType || "All Allocation Types"}
              </strong>
            </span>
            {savingAllocationType && (
              <span className="font-medium text-[#6e287f]">Saving changes…</span>
            )}
          </div>
        </div>
      </section>

      <section className="order-5 rounded-2xl border border-border bg-card p-3 shadow-[0_4px_18px_rgba(40,20,94,0.038)] sm:p-4 lg:order-5 lg:col-start-2">
        <SectionHeading
          title="Notification Management"
          eyebrow="ANNOUNCEMENTS"
          description="Publish an announcement for the team and manage currently active notifications."
        />
        <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3 sm:p-4">
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-foreground" htmlFor="notif-text">
              Notification text
            </Label>
            <Textarea
              id="notif-text"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message to show across the app"
              className="min-h-24 rounded-xl border-border bg-card text-base focus-visible:ring-ring"
            />
            <p className="text-right text-[10px] text-muted-foreground">{text.length}/500</p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-foreground" htmlFor="notif-image">
              Image (optional)
            </Label>
            <Input
              id="notif-image"
              type="file"
              accept="image/*"
              className="h-12 rounded-xl border-border bg-card text-sm file:mr-3 file:rounded-lg file:border file:border-[#edd068] file:bg-[#fef8e2] file:px-3 file:py-1 file:text-xs file:font-semibold file:text-[#28145e]"
              onChange={(e) => void pickImage(e.target.files?.[0] ?? null)}
            />
            {image && <p className="text-xs text-[#6e287f]">Selected: {image.name}</p>}
          </div>
          <Button
            className="h-12 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-sm hover:bg-[#5d2172]"
            disabled={saving || text.trim() === ""}
            onClick={async () => {
              setSaving(true);
              try {
                await addNotif({
                  data: { text: text.trim(), ...(image ? { image } : {}) },
                });
                setText("");
                setImage(null);
                const fileInput = document.getElementById("notif-image") as HTMLInputElement | null;
                if (fileInput) fileInput.value = "";
                await qc.invalidateQueries({ queryKey: APP_CONFIG_KEY });
                toast.success("Notification published");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not save notification");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Publish Notification"}
          </Button>
        </div>

        <div className="mt-3 space-y-2">
          {activeNotifications.length === 0 && (
            <p className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              No active notifications.
            </p>
          )}
          {[...activeNotifications].reverse().map((n) => (
            <div
              key={n.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-foreground">{n.text}</p>
                {n.imageUrl !== "" && (
                  <a
                    href={n.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs font-medium text-[#5d2172] underline hover:text-[#28145e]"
                  >
                    View image
                  </a>
                )}
              </div>
              <Button
                variant="outline"
                className="h-9 shrink-0 rounded-lg border-destructive/30 px-3 text-xs text-destructive hover:bg-destructive/10"
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
