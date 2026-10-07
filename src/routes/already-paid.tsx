import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCollections } from "@/lib/mahavtaar.functions";
import { Button } from "@/components/ui/button";
import { MonthSelect } from "@/components/MonthSelect";
import { currentMonthKey, monthKey, monthOptions } from "@/lib/months";
import { PasswordGate, SETTINGS_SESSION_KEY } from "@/components/PasswordGate";
import {
  ALL_CATEGORIES,
  AlreadyPaidSection,
  CategoryFilter,
  categoryMatches,
  uniqueCategories,
} from "@/components/AllocationFilters";

export const Route = createFileRoute("/already-paid")({
  head: () => ({
    meta: [
      { title: "Already Paid Cases — Mahavtaar Daily Collection" },
      {
        name: "description",
        content: "Protected list of payments made before their allocation date, for reference only.",
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
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: () => fetchCollections(),
  });
  const all = useMemo(() => (data ?? []).filter((r) => r.alreadyPaid), [data]);
  const [month, setMonth] = useState(currentMonthKey());
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const months = useMemo(() => monthOptions((data ?? []).map((r) => r.date)), [data]);
  const categories = useMemo(() => uniqueCategories(data ?? []), [data]);
  const rows = useMemo(
    () =>
      all
        .filter((r) => monthKey(r.date) === month && categoryMatches(r.allocationCategory, category))
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [all, month, category],
  );
  return (
    <div className="space-y-4">
      <p className="text-base text-muted-foreground">
        Payments made before the Allocation Date. Reference only — never counted in any
        collection total.
      </p>
      <Button variant="outline" className="h-12 text-base" onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? "Refreshing..." : "Refresh"}
      </Button>
      <MonthSelect value={month} onChange={setMonth} options={months} />
      <CategoryFilter value={category} onChange={setCategory} options={categories} />
      {isLoading && <p className="text-base">Loading...</p>}
      {error && <p className="text-base text-destructive">Could not load data. Tap Refresh.</p>}
      <AlreadyPaidSection rows={rows} />
    </div>
  );
}
