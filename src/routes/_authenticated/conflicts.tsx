import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Columns,
  Copy,
  Edit2,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  ImageIcon,
  Layers,
  Lock,
  MapPin,
  Maximize2,
  RotateCw,
  Search,
  ShieldAlert,
  Table,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PasswordGate, ADMIN_SESSION_KEY } from "@/components/PasswordGate";
import {
  deleteCollectionRow,
  getCollections,
  markConflictAsValid,
  markConflictGroupAsValid,
  revertConflictValidation,
  updateCollectionRow,
} from "@/lib/mahavtaar.functions";
import { EXECUTIVES, formatAmount, todayISO } from "@/lib/executives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/conflicts")({
  head: () => ({
    meta: [
      { title: "Conflict Resolution & Receipt Verification — Mahavtaar Collection" },
      {
        name: "description",
        content:
          "Compare conflicting entries side-by-side with receipts, verify validity, edit details, or remove duplicates.",
      },
      {
        property: "og:title",
        content: "Conflict Resolution & Receipt Verification — Mahavtaar Collection",
      },
      {
        property: "og:description",
        content:
          "Compare conflicting entries side-by-side with receipts, verify validity, edit details, or remove duplicates.",
      },
    ],
  }),
  component: ConflictsPage,
});

type CollectionItem = {
  row: number;
  executive: string;
  loanId: string;
  amount: number;
  date: string;
  time?: string;
  entryDate?: string;
  entryType?: string;
  settlement?: boolean;
  settlementType?: string;
  receiptLinks?: string[];
  remark?: string;
  city?: string;
  bucket?: string;
  allocationCategory?: string;
  amansRemarks?: string;
  status?: string;
  isValidated?: boolean;
  isConflict?: boolean;
  conflictWith?: { row: number; executive: string; date: string; amount: number }[];
};

type ConflictGroup = {
  key: string;
  loanId: string;
  amount: number;
  items: CollectionItem[];
};

function extractDriveFileId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function getReceiptImageUrl(url: string): string | null {
  const id = extractDriveFileId(url);
  if (id) {
    return `https://lh3.googleusercontent.com/d/${id}=w800`;
  }
  if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
    return url;
  }
  return null;
}

function getReceiptViewUrl(url: string): string {
  if (!url) return "#";
  const id = extractDriveFileId(url);
  if (id) {
    return `https://drive.google.com/file/d/${id}/view?usp=sharing`;
  }
  return url;
}

function getReceiptPreviewUrl(url: string): string | null {
  const id = extractDriveFileId(url);
  if (id) {
    return `https://drive.google.com/file/d/${id}/preview`;
  }
  return null;
}

export function ConflictsPage() {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(ADMIN_SESSION_KEY) === "1") {
      setUnlocked(true);
    }
  }, []);

  if (!unlocked) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Conflict Resolution</h1>
              <p className="text-xs text-muted-foreground">
                Settings &amp; Already Paid पासवर्ड से सुरक्षित
              </p>
            </div>
          </div>
          <PasswordGate
            label="Unlock Conflict Resolution"
            onUnlock={() => {
              setUnlocked(true);
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <ConflictsContent
      onLock={() => {
        sessionStorage.removeItem(ADMIN_SESSION_KEY);
        sessionStorage.removeItem("mahavtaar-admin-credential");
        setUnlocked(false);
      }}
    />
  );
}

function ConflictsContent({ onLock }: { onLock?: () => void }) {
  const fetchCollections = useServerFn(getCollections);
  const updateRow = useServerFn(updateCollectionRow);
  const deleteRow = useServerFn(deleteCollectionRow);
  const markValid = useServerFn(markConflictAsValid);
  const markGroupValid = useServerFn(markConflictGroupAsValid);
  const revertValid = useServerFn(revertConflictValidation);
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<"conflicts" | "verified">("conflicts");
  const [viewMode, setViewMode] = useState<"compare" | "table">("compare");
  const [search, setSearch] = useState("");
  const [selectedExecFilter, setSelectedExecFilter] = useState("__all__");

  // Edit State
  const [editingItem, setEditingItem] = useState<CollectionItem | null>(null);
  const [editExec, setEditExec] = useState("");
  const [editLoanId, setEditLoanId] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editEntryType, setEditEntryType] = useState<"Normal" | "Previous Paid File">("Normal");
  const [editSettlementType, setEditSettlementType] = useState<"No" | "Settlement" | "Foreclosure">(
    "No",
  );
  const [editRemark, setEditRemark] = useState("");
  const [editAmansRemarks, setEditAmansRemarks] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Delete State
  const [deletingItem, setDeletingItem] = useState<CollectionItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Validating Action State
  const [validatingRow, setValidatingRow] = useState<number | null>(null);
  const [validatingGroupKey, setValidatingGroupKey] = useState<string | null>(null);

  // Receipt Modal State (Single Receipt Lightbox)
  const [previewReceipt, setPreviewReceipt] = useState<{
    url: string;
    executive: string;
    row: number;
    loanId: string;
    amount: number;
    date: string;
  } | null>(null);

  // Compare Receipts Modal State (Side-by-Side Receipt Lightbox)
  const [compareReceiptGroup, setCompareReceiptGroup] = useState<ConflictGroup | null>(null);

  const {
    data: rawData = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const res = await fetchCollections();
      return Array.isArray(res) ? (res as CollectionItem[]) : [];
    },
    staleTime: 15_000,
  });

  const collections = useMemo(() => (Array.isArray(rawData) ? rawData : []), [rawData]);

  // Group active conflicting items
  const conflictGroups = useMemo(() => {
    const map = new Map<string, CollectionItem[]>();
    for (const item of collections) {
      if (!item.isConflict) continue;
      const key = `${item.loanId.toLowerCase()}_${item.amount}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }

    const groups: ConflictGroup[] = [];
    for (const [key, items] of map.entries()) {
      if (items.length > 0) {
        groups.push({
          key,
          loanId: items[0]!.loanId,
          amount: items[0]!.amount,
          items,
        });
      }
    }
    return groups;
  }, [collections]);

  // Items verified as valid / not conflicted
  const verifiedItems = useMemo(
    () => collections.filter((item) => item.isValidated),
    [collections],
  );

  // Filter conflict groups
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conflictGroups.filter((g) => {
      if (
        selectedExecFilter !== "__all__" &&
        !g.items.some((i) => i.executive === selectedExecFilter)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        g.loanId.toLowerCase().includes(q) ||
        g.items.some(
          (i) =>
            i.executive.toLowerCase().includes(q) ||
            (i.city ?? "").toLowerCase().includes(q) ||
            (i.remark ?? "").toLowerCase().includes(q),
        )
      );
    });
  }, [conflictGroups, search, selectedExecFilter]);

  // Filter verified items
  const filteredVerified = useMemo(() => {
    const q = search.trim().toLowerCase();
    return verifiedItems.filter((i) => {
      if (selectedExecFilter !== "__all__" && i.executive !== selectedExecFilter) {
        return false;
      }
      if (!q) return true;
      return (
        i.loanId.toLowerCase().includes(q) ||
        i.executive.toLowerCase().includes(q) ||
        (i.city ?? "").toLowerCase().includes(q) ||
        (i.remark ?? "").toLowerCase().includes(q)
      );
    });
  }, [verifiedItems, search, selectedExecFilter]);

  const totalConflictingEntries = useMemo(
    () => conflictGroups.reduce((acc, g) => acc + g.items.length, 0),
    [conflictGroups],
  );

  const totalHeldAmount = useMemo(
    () => conflictGroups.reduce((acc, g) => acc + g.amount * g.items.length, 0),
    [conflictGroups],
  );

  function openEditModal(item: CollectionItem) {
    setEditingItem(item);
    setEditExec(item.executive);
    setEditLoanId(item.loanId);
    setEditAmount(String(item.amount));
    setEditDate(item.date || todayISO());
    setEditEntryType(item.entryType === "Previous Paid File" ? "Previous Paid File" : "Normal");
    const st = item.settlementType;
    setEditSettlementType(
      st === "Foreclosure" ? "Foreclosure" : st === "Settlement" ? "Settlement" : "No",
    );
    setEditRemark(item.remark ?? "");
    setEditAmansRemarks(item.amansRemarks ?? "");
  }

  async function handleSaveEdit() {
    if (!editingItem) return;
    const numAmt = Number(editAmount);
    if (!editExec || !editLoanId || Number.isNaN(numAmt) || numAmt <= 0 || !editDate) {
      toast.error("Please fill all required fields validly.");
      return;
    }

    setIsSaving(true);
    try {
      await updateRow({
        data: {
          row: editingItem.row,
          executive: editExec as never,
          loanId: editLoanId.trim(),
          amount: numAmt,
          date: editDate,
          time: editingItem.time || "",
          entryDate: editingItem.entryDate || editDate,
          entryType: editEntryType,
          settlement: editSettlementType === "Settlement",
          settlementType: editSettlementType,
          receiptLinks: editingItem.receiptLinks ?? [],
          remark: editRemark.trim(),
          amansRemarks: editAmansRemarks.trim(),
        },
      });

      toast.success(`Entry for row ${editingItem.row} updated successfully!`);
      setEditingItem(null);
      await qc.invalidateQueries({ queryKey: ["collections"] });
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update entry.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deletingItem) return;
    setIsDeleting(true);
    try {
      await deleteRow({
        data: { row: deletingItem.row },
      });

      toast.success(`Duplicate entry for row ${deletingItem.row} deleted!`);
      setDeletingItem(null);
      await qc.invalidateQueries({ queryKey: ["collections"] });
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete entry.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleMarkSingleValid(item: CollectionItem) {
    setValidatingRow(item.row);
    try {
      await markValid({
        data: {
          row: item.row,
          note: `Verified on ${item.date} by user`,
        },
      });
      toast.success(
        `Row ${item.row} (${item.executive} · ${formatAmount(item.amount)}) को "Conflict नहीं है, सही है" मार्क कर दिया गया! अब यह कलेक्शन में शामिल होगा।`,
      );
      await qc.invalidateQueries({ queryKey: ["collections"] });
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark as valid.");
    } finally {
      setValidatingRow(null);
    }
  }

  async function handleMarkGroupValid(group: ConflictGroup) {
    setValidatingGroupKey(group.key);
    try {
      const rows = group.items.map((i) => i.row);
      await markGroupValid({
        data: {
          rows,
          note: "Group verified as separate valid payments",
        },
      });
      toast.success(
        `लोन ${group.loanId} की दोनों/सभी ${rows.length} एंट्रीज को वैध (No Conflict) मार्क कर दिया गया! दोनों अब कलेक्शन में शामिल हैं।`,
      );
      await qc.invalidateQueries({ queryKey: ["collections"] });
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark group as valid.");
    } finally {
      setValidatingGroupKey(null);
    }
  }

  async function handleRevertValidation(item: CollectionItem) {
    setValidatingRow(item.row);
    try {
      await revertValid({
        data: { row: item.row },
      });
      toast.success(`Row ${item.row} को वापस Conflicted स्थिति में डाल दिया गया।`);
      await qc.invalidateQueries({ queryKey: ["collections"] });
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revert validation.");
    } finally {
      setValidatingRow(null);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-3 pb-24 pt-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Conflict Resolution</h1>
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800 dark:bg-red-950 dark:text-red-200">
              {conflictGroups.length} Active Conflict Groups
            </span>
            {verifiedItems.length > 0 && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                {verifiedItems.length} Verified Valid
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
            रसीदें देखकर तुलना (Compare) करें — अगर दोनों सही हैं तो &quot;Conflict नहीं है, सही
            है&quot; चुनें, या फिर गलत/डुप्लीकेट एंट्री को एडिट अथवा डिलीट करें।
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onLock && (
            <Button
              variant="outline"
              size="sm"
              className="h-10 text-sm font-medium text-muted-foreground hover:text-foreground shadow-sm"
              onClick={onLock}
              title="Lock page session"
            >
              <Lock className="mr-1.5 h-4 w-4" />
              Lock
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-10 text-sm font-medium shadow-sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RotateCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Syncing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span>Active Conflicts</span>
          </div>
          <p className="mt-1 text-xl font-bold text-amber-600 sm:text-2xl">
            {conflictGroups.length}
          </p>
          <p className="text-[11px] text-muted-foreground">Unique Loan ID & Amount pairs</p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <Layers className="h-4 w-4 text-red-600" />
            <span>Held Entries</span>
          </div>
          <p className="mt-1 text-xl font-bold text-red-600 sm:text-2xl">
            {totalConflictingEntries}
          </p>
          <p className="text-[11px] text-muted-foreground">Excluded from Collection Totals</p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <Calendar className="h-4 w-4 text-primary" />
            <span>Held Amount</span>
          </div>
          <p className="mt-1 text-xl font-bold text-primary sm:text-2xl">
            {formatAmount(totalHeldAmount)}
          </p>
          <p className="text-[11px] text-muted-foreground">Awaiting resolution or approval</p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>Verified as Valid</span>
          </div>
          <p className="mt-1 text-xl font-bold text-emerald-600 sm:text-2xl">
            {verifiedItems.length}
          </p>
          <p className="text-[11px] text-muted-foreground">Marked &quot;Conflict नहीं है&quot;</p>
        </div>
      </div>

      {/* Navigation Tabs & View Controls */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("conflicts")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === "conflicts"
                ? "bg-amber-100 text-amber-950 dark:bg-amber-950/80 dark:text-amber-200 shadow-sm"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Active Conflicts
            <span className="rounded-full bg-amber-200/80 px-2 py-0.5 text-xs font-bold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
              {conflictGroups.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("verified")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === "verified"
                ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/80 dark:text-emerald-200 shadow-sm"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Verified Valid (Conflict नहीं है)
            <span className="rounded-full bg-emerald-200/80 px-2 py-0.5 text-xs font-bold text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
              {verifiedItems.length}
            </span>
          </button>
        </div>

        {activeTab === "conflicts" && (
          <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setViewMode("compare")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "compare"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Columns className="h-3.5 w-3.5" />
              Comparing View (तुलनात्मक)
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "table"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Table className="h-3.5 w-3.5" />
              Table View
            </button>
          </div>
        )}
      </div>

      {/* Search & Filter Toolbar */}
      <section className="mt-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Search Loan ID / Executive / City / Remark
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by loan ID, executive name, city..."
                className="h-10 pl-9 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Filter by Executive</Label>
            <Select value={selectedExecFilter} onValueChange={setSelectedExecFilter}>
              <SelectTrigger className="h-10 text-sm">
                <SelectValue placeholder="All Executives" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Executives</SelectItem>
                {EXECUTIVES.map((exec) => (
                  <SelectItem key={exec} value={exec}>
                    {exec}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* Loading & Error States */}
      {isLoading && (
        <div className="mt-8 rounded-xl border p-12 text-center text-muted-foreground">
          <RotateCw className="mx-auto h-6 w-6 animate-spin mb-2" />
          Checking for conflicts and receipts in Google Sheets...
        </div>
      )}

      {error && (
        <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center text-destructive">
          <p className="font-semibold text-base">Could not load conflict entries</p>
          <p className="mt-1 text-sm opacity-90">
            {error instanceof Error ? error.message : "Error connecting to server"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 bg-background text-foreground"
            onClick={() => refetch()}
          >
            <RotateCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      )}

      {/* TAB 1: ACTIVE CONFLICTS */}
      {activeTab === "conflicts" && !isLoading && !error && (
        <section className="mt-6 space-y-6">
          {conflictGroups.length === 0 && (
            <div className="rounded-xl border border-emerald-300/80 bg-emerald-50/80 p-10 text-center dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600 dark:text-emerald-400 mb-2" />
              <h3 className="text-lg font-bold text-emerald-900 dark:text-emerald-200">
                All Entries Are Clean! (No Active Conflicts)
              </h3>
              <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-300/80">
                गूगल शीट में कोई भी एक्टिव डुप्लीकेट या कॉन्फ्लिक्टिंग पेमेंट रिकॉर्ड नहीं है। सभी
                कलेक्शन सुरक्षित हैं।
              </p>
            </div>
          )}

          {conflictGroups.length > 0 && filteredGroups.length === 0 && (
            <div className="rounded-xl border p-10 text-center text-muted-foreground">
              No conflict records match your search criteria.
            </div>
          )}

          {filteredGroups.map((group, groupIdx) => {
            const hasMultipleReceipts = group.items.some((i) => (i.receiptLinks?.length ?? 0) > 0);
            const distinctDates = [...new Set(group.items.map((i) => i.date))];
            const distinctExecs = [...new Set(group.items.map((i) => i.executive))];
            const isDifferentDates = distinctDates.length > 1;
            const isDifferentExecs = distinctExecs.length > 1;

            return (
              <article
                key={`${group.key}-${groupIdx}`}
                className="rounded-xl border-2 border-amber-300/90 bg-card shadow-sm overflow-hidden dark:border-amber-900/70"
              >
                {/* Group Diagnostic Header */}
                <div className="border-b border-amber-200/90 bg-amber-50/90 px-4 py-3.5 dark:border-amber-900/60 dark:bg-amber-950/40">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 text-white font-bold text-xs">
                          !
                        </span>
                        <h3 className="text-base font-bold text-amber-950 dark:text-amber-100 sm:text-lg">
                          Loan ID:{" "}
                          <span className="font-mono underline decoration-amber-400">
                            {group.loanId}
                          </span>
                        </h3>
                        <span className="rounded-md bg-primary px-2 py-0.5 font-mono text-xs font-bold text-primary-foreground sm:text-sm">
                          Amount: {formatAmount(group.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(group.loanId, "Loan ID")}
                          className="rounded p-1 text-muted-foreground hover:bg-amber-200/60 hover:text-foreground"
                          title="Copy Loan ID"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Diagnostic Analysis Badges */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                        {isDifferentDates ? (
                          <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-900 dark:bg-blue-950 dark:text-blue-200">
                            <Calendar className="h-3 w-3" />
                            अलग-अलग तिथियाँ: {distinctDates.join(" vs ")} (अलग-अलग EMI किस्त हो सकती
                            है)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-200">
                            <Clock className="h-3 w-3" />
                            एक ही तारीख ({distinctDates[0]}) — संभावित डबल एंट्री
                          </span>
                        )}

                        {isDifferentExecs ? (
                          <span className="inline-flex items-center gap-1 rounded bg-purple-100 px-2 py-0.5 font-medium text-purple-900 dark:bg-purple-950 dark:text-purple-200">
                            एग्जीक्यूटिव्स: {distinctExecs.join(" & ")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-stone-100 px-2 py-0.5 font-medium text-stone-800 dark:bg-stone-900 dark:text-stone-300">
                            Same Executive: {distinctExecs[0]}
                          </span>
                        )}

                        {hasMultipleReceipts ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                            <ImageIcon className="h-3 w-3" />
                            रसीदें उपलब्ध हैं (Comparing View में रसीदें देखें)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 font-medium text-red-900 dark:bg-red-950 dark:text-red-200">
                            <AlertTriangle className="h-3 w-3" />
                            रसीद लिंक गायब
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Group Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                      {hasMultipleReceipts && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 border-primary/40 bg-background text-xs font-semibold text-primary hover:bg-primary/10 shadow-xs"
                          onClick={() => setCompareReceiptGroup(group)}
                        >
                          <Eye className="mr-1.5 h-3.5 w-3.5" />
                          Compare Receipts Side-by-Side
                        </Button>
                      )}

                      <Button
                        type="button"
                        size="sm"
                        className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs"
                        onClick={() => handleMarkGroupValid(group)}
                        disabled={validatingGroupKey === group.key}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />
                        {validatingGroupKey === group.key
                          ? "Validating..."
                          : "Conflict नहीं है — दोनों सही हैं"}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* VIEW MODE: COMPARING VIEW (SIDE-BY-SIDE) */}
                {viewMode === "compare" ? (
                  <div className="p-4 bg-muted/10">
                    <div className="grid gap-4 md:grid-cols-2">
                      {group.items.map((item, idx) => {
                        const receiptUrl = item.receiptLinks?.[0] || "";
                        const receiptImg = getReceiptImageUrl(receiptUrl);
                        const otherItem = group.items.find((i) => i.row !== item.row);
                        const isDateDiff = otherItem && item.date !== otherItem.date;
                        const isExecDiff = otherItem && item.executive !== otherItem.executive;

                        return (
                          <div
                            key={item.row}
                            className="flex flex-col rounded-xl border bg-card p-4 shadow-xs relative transition-all hover:border-primary/40"
                          >
                            {/* Card Header */}
                            <div className="flex items-center justify-between border-b pb-3">
                              <div className="flex items-center gap-2.5">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 font-bold text-xs text-primary">
                                  {item.executive.charAt(0)}
                                </span>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-sm text-foreground">
                                      {item.executive}
                                    </h4>
                                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
                                      Row {item.row}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground">
                                    Entry #{idx + 1} of this group
                                  </p>
                                </div>
                              </div>

                              <div className="text-right">
                                <span className="font-mono text-base font-bold text-primary">
                                  {formatAmount(item.amount)}
                                </span>
                              </div>
                            </div>

                            {/* RECEIPT SECTION (USER REQUEST) */}
                            <div className="mt-3 rounded-lg border bg-muted/20 p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                  <ImageIcon className="h-3.5 w-3.5 text-primary" />
                                  Payment Receipt (रसीद):
                                </span>
                                {item.receiptLinks && item.receiptLinks.length > 1 && (
                                  <span className="text-[10px] text-muted-foreground font-medium">
                                    {item.receiptLinks.length} Files Attached
                                  </span>
                                )}
                              </div>

                              {receiptUrl ? (
                                <div className="space-y-2">
                                  {/* Thumbnail Preview */}
                                  <div
                                    className="group relative flex aspect-[16/9] w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-black/5 dark:bg-white/5 transition-all hover:ring-2 hover:ring-primary"
                                    onClick={() =>
                                      setPreviewReceipt({
                                        url: receiptUrl,
                                        executive: item.executive,
                                        row: item.row,
                                        loanId: item.loanId,
                                        amount: item.amount,
                                        date: item.date,
                                      })
                                    }
                                  >
                                    {receiptImg ? (
                                      <img
                                        src={receiptImg}
                                        alt={`Receipt Row ${item.row}`}
                                        className="h-full w-full object-contain transition-transform group-hover:scale-105"
                                        loading="lazy"
                                        onError={(e) => {
                                          // fallback if image fails to render
                                          (e.target as HTMLElement).style.display = "none";
                                        }}
                                      />
                                    ) : null}

                                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                                      <span className="flex items-center gap-1.5 rounded-md bg-white/95 px-3 py-1.5 text-xs font-semibold text-black shadow-md">
                                        <Maximize2 className="h-3.5 w-3.5" /> View Receipt
                                      </span>
                                    </div>
                                  </div>

                                  {/* Direct Link Controls */}
                                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 text-[11px] font-medium text-primary hover:bg-primary/10"
                                      onClick={() =>
                                        setPreviewReceipt({
                                          url: receiptUrl,
                                          executive: item.executive,
                                          row: item.row,
                                          loanId: item.loanId,
                                          amount: item.amount,
                                          date: item.date,
                                        })
                                      }
                                    >
                                      <Eye className="mr-1 h-3 w-3" /> Full Preview
                                    </Button>

                                    <a
                                      href={getReceiptViewUrl(receiptUrl)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                                    >
                                      <ExternalLink className="h-3 w-3" /> Google Drive Link
                                    </a>
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-md border border-amber-300/80 bg-amber-50/80 p-3 text-center text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                                  <AlertTriangle className="mx-auto h-5 w-5 text-amber-600 mb-1" />
                                  <p className="font-semibold">कोई रसीद लिंक अपलोड नहीं है</p>
                                  <p className="text-[11px] opacity-80">
                                    इस एंट्री में रसीद नहीं जोड़ी गई थी।
                                  </p>
                                </div>
                              )}
                            </div>

                            {/* Comparison Attributes Grid */}
                            <div className="mt-3 flex-1 space-y-2 text-xs">
                              <div
                                className={`flex items-center justify-between rounded-md p-2 ${
                                  isDateDiff
                                    ? "bg-blue-50 font-semibold text-blue-950 dark:bg-blue-950/60 dark:text-blue-200 border border-blue-200"
                                    : "bg-muted/30"
                                }`}
                              >
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                  <Calendar className="h-3.5 w-3.5" /> Payment Date:
                                </span>
                                <span className="font-bold">
                                  {item.date || "—"}{" "}
                                  {isDateDiff && <span className="text-[10px]">⚡ Differs</span>}
                                </span>
                              </div>

                              <div className="flex items-center justify-between rounded-md bg-muted/20 p-2">
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                  <Clock className="h-3.5 w-3.5" /> Entry Time:
                                </span>
                                <span className="font-medium">{item.time || "—"}</span>
                              </div>

                              <div className="flex items-center justify-between rounded-md bg-muted/20 p-2">
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                  <MapPin className="h-3.5 w-3.5" /> City & Bucket:
                                </span>
                                <span className="font-medium">
                                  {item.city || "—"} · {item.bucket || "—"}
                                </span>
                              </div>

                              <div className="flex items-center justify-between rounded-md bg-muted/20 p-2">
                                <span className="text-muted-foreground">Entry Type:</span>
                                <span className="font-medium">{item.entryType || "Normal"}</span>
                              </div>

                              <div className="flex items-center justify-between rounded-md bg-muted/20 p-2">
                                <span className="text-muted-foreground">Settlement Status:</span>
                                <span>
                                  {item.settlementType === "Foreclosure" ? (
                                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">
                                      Foreclosure
                                    </span>
                                  ) : item.settlement ? (
                                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">
                                      Settlement
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">No</span>
                                  )}
                                </span>
                              </div>

                              {item.remark && (
                                <div className="rounded-md bg-muted/30 p-2">
                                  <span className="font-semibold text-muted-foreground">
                                    Remark:
                                  </span>{" "}
                                  <span className="italic">{item.remark}</span>
                                </div>
                              )}

                              {item.amansRemarks && (
                                <div className="rounded-md bg-amber-50/60 p-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                                  <span className="font-semibold">Sheet Check:</span>{" "}
                                  {item.amansRemarks}
                                </div>
                              )}
                            </div>

                            {/* Card Action Buttons */}
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                                onClick={() => handleMarkSingleValid(item)}
                                disabled={validatingRow === item.row}
                              >
                                <Check className="mr-1 h-3.5 w-3.5" />
                                {validatingRow === item.row
                                  ? "Saving..."
                                  : "Conflict नहीं है, सही है"}
                              </Button>

                                                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2.5 text-xs font-medium border-primary/30 text-primary hover:bg-primary/10"
                                onClick={() => openEditModal(item)}
                              >
                                <Edit2 className="mr-1 h-3.5 w-3.5" />
                                Edit
                              </Button>

                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="h-8 px-2.5 text-xs font-medium"
                                onClick={() => setDeletingItem(item)}
                              >
                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* VIEW MODE: COMPACT TABLE */
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 font-semibold text-muted-foreground">
                          <th className="px-3 py-2 text-left">Sheet Row</th>
                          <th className="px-3 py-2 text-left">Executive</th>
                          <th className="px-3 py-2 text-left">Payment Date</th>
                          <th className="px-3 py-2 text-left">Receipt</th>
                          <th className="px-3 py-2 text-left">City</th>
                          <th className="px-3 py-2 text-left">Entry Type</th>
                          <th className="px-3 py-2 text-right font-bold text-foreground">Amount</th>
                          <th className="px-3 py-2 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {group.items.map((item) => {
                          const receiptUrl = item.receiptLinks?.[0] || "";
                          return (
                            <tr key={item.row} className="hover:bg-muted/20">
                              <td className="px-3 py-2.5 font-mono font-medium text-muted-foreground">
                                Row {item.row}
                              </td>
                              <td className="px-3 py-2.5 font-bold text-foreground">
                                {item.executive}
                              </td>
                              <td className="px-3 py-2.5 font-medium">
                                {item.date || "—"}
                                {item.time ? ` · ${item.time}` : ""}
                              </td>
                              <td className="px-3 py-2.5">
                                {receiptUrl ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-primary font-medium"
                                    onClick={() =>
                                      setPreviewReceipt({
                                        url: receiptUrl,
                                        executive: item.executive,
                                        row: item.row,
                                        loanId: item.loanId,
                                        amount: item.amount,
                                        date: item.date,
                                      })
                                    }
                                  >
                                    <Eye className="mr-1 h-3 w-3" /> View Receipt
                                  </Button>
                                ) : (
                                  <span className="text-muted-foreground text-xs">No receipt</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5">{item.city || "—"}</td>
                              <td className="px-3 py-2.5">{item.entryType || "Normal"}</td>
                              <td className="px-3 py-2.5 text-right font-bold text-primary">
                                {formatAmount(item.amount)}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-2"
                                    onClick={() => handleMarkSingleValid(item)}
                                    disabled={validatingRow === item.row}
                                  >
                                    <Check className="mr-1 h-3 w-3" />
                                    Valid
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => openEditModal(item)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setDeletingItem(item)}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {/* TAB 2: VERIFIED VALID ITEMS */}
      {activeTab === "verified" && !isLoading && !error && (
        <section className="mt-6 space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <div>
                <h3 className="font-bold text-sm sm:text-base">
                  Approved &amp; Verified Entries ({verifiedItems.length})
                </h3>
                <p className="text-xs opacity-90">
                  ये वो एंट्रीज हैं जिन्हें आपने &quot;Conflict नहीं है, सही है&quot; मार्क किया है।
                  ये सभी अब कलेक्शन व रिपोर्ट्स में शामिल हैं। अगर गलती से किया हो तो आप वापस Revert
                  कर सकते हैं।
                </p>
              </div>
            </div>
          </div>

          {verifiedItems.length === 0 && (
            <div className="rounded-xl border p-12 text-center text-muted-foreground">
              अभी तक किसी एंट्री को &quot;Conflict नहीं है&quot; के रूप में अप्रूव नहीं किया गया है।
            </div>
          )}

          {verifiedItems.length > 0 && filteredVerified.length === 0 && (
            <div className="rounded-xl border p-10 text-center text-muted-foreground">
              No verified records match your search criteria.
            </div>
          )}

          {filteredVerified.length > 0 && (
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 font-semibold text-muted-foreground">
                      <th className="px-3 py-2 text-left">Sheet Row</th>
                      <th className="px-3 py-2 text-left">Executive</th>
                      <th className="px-3 py-2 text-left">Loan ID</th>
                      <th className="px-3 py-2 text-left">Payment Date</th>
                      <th className="px-3 py-2 text-left">Receipt</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right font-bold text-foreground">Amount</th>
                      <th className="px-3 py-2 text-center">Revert</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredVerified.map((item) => {
                      const receiptUrl = item.receiptLinks?.[0] || "";
                      return (
                        <tr key={item.row} className="hover:bg-muted/20">
                          <td className="px-3 py-2.5 font-mono text-muted-foreground">
                            Row {item.row}
                          </td>
                          <td className="px-3 py-2.5 font-bold text-foreground">
                            {item.executive}
                          </td>
                          <td className="px-3 py-2.5 font-mono font-medium">{item.loanId}</td>
                          <td className="px-3 py-2.5 font-medium">{item.date}</td>
                          <td className="px-3 py-2.5">
                            {receiptUrl ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-primary font-medium"
                                onClick={() =>
                                  setPreviewReceipt({
                                    url: receiptUrl,
                                    executive: item.executive,
                                    row: item.row,
                                    loanId: item.loanId,
                                    amount: item.amount,
                                    date: item.date,
                                  })
                                }
                              >
                                <Eye className="mr-1 h-3 w-3" /> View
                              </Button>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                              Verified Valid
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold text-emerald-600">
                            {formatAmount(item.amount)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 text-xs font-medium text-amber-700 hover:bg-amber-50"
                              onClick={() => handleRevertValidation(item)}
                              disabled={validatingRow === item.row}
                            >
                              <Undo2 className="mr-1 h-3 w-3" /> Revert
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* SINGLE RECEIPT PREVIEW LIGHTBOX MODAL */}
      <Dialog open={previewReceipt !== null} onOpenChange={(o) => !o && setPreviewReceipt(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-4">
              <span>
                Payment Receipt — {previewReceipt?.executive} (Row {previewReceipt?.row})
              </span>
            </DialogTitle>
            <DialogDescription>
              Loan ID: <span className="font-mono font-bold">{previewReceipt?.loanId}</span> ·
              Amount:{" "}
              <span className="font-bold">
                {previewReceipt && formatAmount(previewReceipt.amount)}
              </span>{" "}
              · Date: {previewReceipt?.date}
            </DialogDescription>
          </DialogHeader>

          {previewReceipt && (
            <div className="space-y-4 py-2">
              <div className="flex min-h-[350px] w-full items-center justify-center rounded-lg border bg-black/5 dark:bg-white/5 p-2 overflow-hidden">
                {getReceiptImageUrl(previewReceipt.url) ? (
                  <img
                    src={getReceiptImageUrl(previewReceipt.url)!}
                    alt="Payment Receipt Preview"
                    className="max-h-[70vh] w-auto max-w-full rounded object-contain shadow-sm"
                  />
                ) : (
                  <iframe
                    src={getReceiptPreviewUrl(previewReceipt.url) || previewReceipt.url}
                    title="Receipt Document Viewer"
                    className="h-[500px] w-full rounded border-0"
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <a
                  href={getReceiptViewUrl(previewReceipt.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Full File in Google Drive
                </a>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewReceipt(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* SIDE-BY-SIDE RECEIPT COMPARISON MODAL */}
      <Dialog
        open={compareReceiptGroup !== null}
        onOpenChange={(o) => !o && setCompareReceiptGroup(null)}
      >
        <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              Side-by-Side Receipt Comparison (रसीद तुलना)
            </DialogTitle>
            <DialogDescription>
              Loan ID: <span className="font-mono font-bold">{compareReceiptGroup?.loanId}</span> ·
              Amount:{" "}
              <span className="font-bold">
                {compareReceiptGroup && formatAmount(compareReceiptGroup.amount)}
              </span>
            </DialogDescription>
          </DialogHeader>

          {compareReceiptGroup && (
            <div className="space-y-4 py-2">
              <div className="grid gap-4 md:grid-cols-2">
                {compareReceiptGroup.items.map((item, idx) => {
                  const receiptUrl = item.receiptLinks?.[0] || "";
                  const receiptImg = getReceiptImageUrl(receiptUrl);

                  return (
                    <div
                      key={item.row}
                      className="flex flex-col rounded-xl border bg-card p-3 shadow-xs space-y-3"
                    >
                      {/* Top Info */}
                      <div className="flex items-center justify-between border-b pb-2">
                        <div>
                          <span className="font-bold text-sm text-foreground">
                            {item.executive}
                          </span>
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground font-semibold">
                            Row {item.row}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-semibold text-primary">
                            Date: {item.date}
                          </span>
                        </div>
                      </div>

                      {/* Image Viewer */}
                      <div className="flex min-h-[300px] max-h-[500px] w-full items-center justify-center rounded-lg border bg-black/5 dark:bg-white/5 p-2 overflow-hidden">
                        {receiptImg ? (
                          <img
                            src={receiptImg}
                            alt={`Receipt Row ${item.row}`}
                            className="max-h-[450px] w-auto max-w-full rounded object-contain"
                          />
                        ) : receiptUrl ? (
                          <iframe
                            src={getReceiptPreviewUrl(receiptUrl) || receiptUrl}
                            title={`Receipt ${item.row}`}
                            className="h-[350px] w-full rounded border-0"
                          />
                        ) : (
                          <div className="p-6 text-center text-muted-foreground text-xs">
                            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-2" />
                            No receipt uploaded for this entry.
                          </div>
                        )}
                      </div>

                      {/* Card Details & Action */}
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between text-muted-foreground">
                          <span>Amount:</span>
                          <span className="font-bold text-foreground">
                            {formatAmount(item.amount)}
                          </span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>City / Bucket:</span>
                          <span className="font-medium text-foreground">
                            {item.city || "—"} / {item.bucket || "—"}
                          </span>
                        </div>
                        {item.remark && (
                          <div className="rounded bg-muted/40 p-1.5 text-[11px]">
                            <span className="font-semibold">Remark:</span> {item.remark}
                          </div>
                        )}
                      </div>

                      <div className="border-t pt-2 flex items-center justify-between gap-2">
                        {receiptUrl && (
                          <a
                            href={getReceiptViewUrl(receiptUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-primary hover:underline flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" /> Drive File
                          </a>
                        )}

                        <Button
                          type="button"
                          size="sm"
                          className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold ml-auto"
                          onClick={() => {
                            handleMarkSingleValid(item);
                            setCompareReceiptGroup(null);
                          }}
                        >
                          <Check className="mr-1 h-3 w-3" />
                          Conflict नहीं है, सही है
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <Button
                  type="button"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold"
                  onClick={() => {
                    handleMarkGroupValid(compareReceiptGroup);
                    setCompareReceiptGroup(null);
                  }}
                >
                  <Check className="mr-1.5 h-4 w-4" />
                  दोनों रसीदें अलग/वैध हैं (Approve Both as Valid)
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCompareReceiptGroup(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* EDIT MODAL */}
      <Dialog open={editingItem !== null} onOpenChange={(o) => !o && setEditingItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Conflicting Entry (Row {editingItem?.row})</DialogTitle>
            <DialogDescription>
              एंट्री में सही जानकारी दर्ज करें ताकि कॉन्फ्लिक्ट रिज़ॉल्व हो सके और कलेक्शन में शामिल
              हो सके।
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2 text-sm">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Executive Name</Label>
              <Select value={editExec} onValueChange={setEditExec}>
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXECUTIVES.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Loan ID / Number</Label>
                <Input
                  value={editLoanId}
                  onChange={(e) => setEditLoanId(e.target.value)}
                  className="h-10 text-sm font-mono"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-medium">Amount (₹)</Label>
                <Input
                  type="number"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="h-10 text-sm font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Payment Date</Label>
                <Input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-medium">Entry Type</Label>
                <Select
                  value={editEntryType}
                  onValueChange={(v) => setEditEntryType(v as "Normal" | "Previous Paid File")}
                >
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Normal">Normal</SelectItem>
                    <SelectItem value="Previous Paid File">Previous Paid File</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Settlement Type</Label>
              <Select
                value={editSettlementType}
                onValueChange={(v) =>
                  setEditSettlementType(v as "No" | "Settlement" | "Foreclosure")
                }
              >
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="No">No Settlement</SelectItem>
                  <SelectItem value="Settlement">Settlement</SelectItem>
                  <SelectItem value="Foreclosure">Foreclosure</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Remark</Label>
              <Textarea
                value={editRemark}
                onChange={(e) => setEditRemark(e.target.value)}
                placeholder="Reason for correction or remark..."
                rows={2}
                className="text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Aman's Remarks (Column S)</Label>
              <Textarea
                value={editAmansRemarks}
                onChange={(e) => setEditAmansRemarks(e.target.value)}
                placeholder="Write Aman's Remarks (e.g. Verified by Aman, Checked, etc.)..."
                rows={2}
                className="text-sm"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingItem(null)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveEdit} disabled={isSaving}>
              {isSaving ? "Saving Changes..." : "Save & Update Sheet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION MODAL */}
      <Dialog open={deletingItem !== null} onOpenChange={(o) => !o && setDeletingItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">
              Delete Conflicting Entry (Row {deletingItem?.row})?
            </DialogTitle>
            <DialogDescription>
              क्या आप **{deletingItem?.executive}** द्वारा लोन ID **{deletingItem?.loanId}** (अमाउंट{" "}
              {deletingItem && formatAmount(deletingItem.amount)}) की यह डुप्लीकेट एंट्री गूगल शीट
              से हटाना चाहते हैं?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingItem(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </main>
  );
}
