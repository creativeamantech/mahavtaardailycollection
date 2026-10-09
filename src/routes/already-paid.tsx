import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { getCollections, highlightAlreadyPaidInSheet } from "@/lib/mahavtaar.functions";
import { Button } from "@/components/ui/button";
import { MonthSelect } from "@/components/MonthSelect";
import { currentMonthKey, monthKey, monthOptions } from "@/lib/months";
import { PasswordGate, SETTINGS_SESSION_KEY } from "@/components/PasswordGate";
import { downloadAlreadyPaidCsv } from "@/lib/export";
import {
  ALL_CATEGORIES,
  AlreadyPaidSection,
  CategoryFilter,
  categoryMatches,
  uniqueCategories,
  useCategoryFilter,
} from "@/components/AllocationFilters";

export const Route = createFileRoute("/already-paid")({
  head: () => ({
    meta: [
      { title: "Already Paid Cases — Mahavtaar Daily Collection" },
      {
        name: "description",
        content:
          "Protected list of payments made before their allocation date, for reference only.",
      },
      { property: "og:title", content: "Already Paid Cases — Mahavtaar Daily Collection" },
      {
        property: "og:description",
        content: "Payments made before allocation date, excluded from all collection totals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlreadyPaidPage,
});

function AlreadyPaidPage() {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem(SETTINGS_SESSION_KEY) === "1") setUnlocked(true);
  }, []);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 pb-16 pt-6">
      <h1 className="text-2xl font-bold tracking-tight">Already Paid</h1>
      {unlocked ? (
        <AlreadyPaidContent />
      ) : (
        <PasswordGate
          label="Unlock Already Paid"
          onUnlock={() => {
            sessionStorage.setItem(SETTINGS_SESSION_KEY, "1");
            setUnlocked(true);
          }}
        />
      )}
    </main>
  );
}

function AlreadyPaidContent() {
  const fetchCollections = useServerFn(getCollections);
  const highlightAlreadyPaid = useServerFn(highlightAlreadyPaidInSheet);
  const [highlighting, setHighlighting] = useState(false);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const res = await fetchCollections();
      if (!Array.isArray(res)) {
        if (res && typeof res === "object" && "message" in res) {
          throw new Error(
            String((res as { message?: unknown }).message || "Failed to load collections"),
          );
        }
        if (res && typeof res === "object" && "error" in res) {
          throw new Error(
            String((res as { error?: unknown }).error || "Failed to load collections"),
          );
        }
        throw new Error("Unable to load collections from server");
      }
      return res;
    },
  });
  const collections = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const all = useMemo(() => collections.filter((r) => r.alreadyPaid), [collections]);
  const [month, setMonth] = useState(currentMonthKey());
  const [category, setCategory] = useCategoryFilter();
  const months = useMemo(() => monthOptions(collections.map((r) => r.date)), [collections]);
  const categories = useMemo(() => uniqueCategories(collections), [collections]);
  const rows = useMemo(
    () =>
      all
        .filter(
          (r) => monthKey(r.date) === month && categoryMatches(r.allocationCategory, category),
        )
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [all, month, category],
  );

  const alreadyPaidRowNumbers = useMemo(
    () => all.map((r) => r.row).filter(Boolean) as number[],
    [all],
  );

  // Auto-sync red highlight in Google Sheets
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!syncedRef.current && alreadyPaidRowNumbers.length > 0) {
      syncedRef.current = true;
      highlightAlreadyPaid({ data: { rows: alreadyPaidRowNumbers } }).catch(() => {});
    }
  }, [alreadyPaidRowNumbers, highlightAlreadyPaid]);

  const syncHighlight = async () => {
    if (alreadyPaidRowNumbers.length === 0) {
      toast.info("No Already Paid cases found to highlight in Google Sheet.");
      return;
    }
    setHighlighting(true);
    try {
      const res = await highlightAlreadyPaid({ data: { rows: alreadyPaidRowNumbers } });
      toast.success(
        `${(res as { count?: number })?.count ?? alreadyPaidRowNumbers.length} Already Paid cases highlighted in Red in Google Sheet.`,
      );
    } catch {
      toast.error("Could not highlight Already Paid rows in Google Sheet.");
    } finally {
      setHighlighting(false);
    }
  };

  const handleDownloadFiltered = async () => {
    if (rows.length === 0) {
      toast.error("No already paid cases to download for this selection.");
      return;
    }
    const catLabel =
      category && category !== ALL_CATEGORIES
        ? `-${category.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`
        : "";
    // Ensure red highlight is synced
    highlightAlreadyPaid({
      data: { rows: rows.map((r) => r.row).filter(Boolean) as number[] },
    }).catch(() => {});
    downloadAlreadyPaidCsv(rows, `${month}${catLabel}`);
    toast.success(`Downloaded ${rows.length} already paid cases with "Already Paid" column.`);
  };

  const handleDownloadAll = async () => {
    if (all.length === 0) {
      toast.error("No already paid cases found.");
      return;
    }
    highlightAlreadyPaid({ data: { rows: alreadyPaidRowNumbers } }).catch(() => {});
    downloadAlreadyPaidCsv(all, "all-months");
    toast.success(`Downloaded all ${all.length} already paid cases with "Already Paid" column.`);
  };

  return (
    <div className="space-y-4">
      <p className="text-base text-muted-foreground">
        Payments made before the Allocation Date. Reference only — never counted in any collection
        total.
      </p>

      {all.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/70 p-3 text-sm text-red-900">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-full bg-red-600 animate-pulse" />
            <span>
              <strong>{all.length} Already Paid cases</strong> are highlighted in RED in Google
              Sheet & exported with "Already Paid" column.
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-red-300 bg-white text-xs text-red-800 hover:bg-red-50"
            disabled={highlighting}
            onClick={syncHighlight}
          >
            {highlighting ? "Highlighting..." : "Re-sync Red in Google Sheet"}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="h-12 text-base"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
        <Button
          variant="outline"
          className="h-12 text-base"
          onClick={handleDownloadFiltered}
          disabled={rows.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          Download CSV ({rows.length})
        </Button>
        {all.length > rows.length && (
          <Button
            variant="ghost"
            className="h-12 text-base text-muted-foreground hover:text-foreground"
            onClick={handleDownloadAll}
            disabled={all.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Download All Months ({all.length})
          </Button>
        )}
      </div>
      <MonthSelect value={month} onChange={setMonth} options={months} />
      <CategoryFilter value={category} onChange={setCategory} options={categories} />
      {isLoading && <p className="text-base">Loading...</p>}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          <p className="font-semibold">Could not load collections data</p>
          <p className="mt-1 text-sm opacity-90">
            {error instanceof Error ? error.message : "Tap Refresh to retry."}
          </p>
        </div>
      )}
      <AlreadyPaidSection rows={rows} onDownload={handleDownloadFiltered} />
    </div>
  );
}
