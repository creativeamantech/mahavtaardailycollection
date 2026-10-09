import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { formatAmount } from "@/lib/executives";
import { useAppConfig } from "@/hooks/useAppConfig";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Collection = {
  executive: string;
  loanId?: string;
  amount: number;
  date: string;
  createdAt?: string;
  allocationCategory?: string;
  allocationDate?: string;
};

export function categoryMatches(c: string | undefined, filter: string) {
  return filter === ALL_CATEGORIES || (c ?? "") === filter;
}

export function uniqueCategories(rows: { allocationCategory?: string }[] | unknown) {
  const list = Array.isArray(rows) ? rows : [];
  return [
    ...new Set(
      list
        .map(
          (r) =>
            (r && typeof r === "object"
              ? (r as { allocationCategory?: string }).allocationCategory
              : "") ?? "",
        )
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export const ALL_CATEGORIES = "__all_categories__";

// Category filter state that starts on the Settings-chosen default category
// (applied once, when the config arrives; the user can still change it freely).
export function useCategoryFilter() {
  const { defaultCategory } = useAppConfig();
  const targetDefault =
    defaultCategory && defaultCategory !== ALL_CATEGORIES ? defaultCategory : ALL_CATEGORIES;
  const [category, setCategoryState] = useState(targetDefault);
  const lastDefaultRef = useRef(defaultCategory);
  const userModified = useRef(false);

  useEffect(() => {
    if (!userModified.current && defaultCategory !== lastDefaultRef.current) {
      lastDefaultRef.current = defaultCategory;
      setCategoryState(targetDefault);
    }
  }, [defaultCategory, targetDefault]);

  const setCategory = (val: string | ((prev: string) => string)) => {
    userModified.current = true;
    setCategoryState(val);
  };

  return [category, setCategory] as const;
}

export function CategoryFilter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const mergedOptions = useMemo(() => {
    if (value && value !== ALL_CATEGORIES && !options.includes(value)) {
      return [value, ...options];
    }
    return options;
  }, [value, options]);

  return (
    <div className="space-y-2">
      <Label className="text-base">Allocation Category</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12 text-base">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_CATEGORIES} className="text-base">
            All Categories
          </SelectItem>
          {mergedOptions.map((c) => (
            <SelectItem key={c} value={c} className="text-base">
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Informational only — these payments were made before the Allocation Date
// and never contribute to any collection total.
export function AlreadyPaidSection({
  rows,
  onDownload,
}: {
  rows: Collection[];
  onDownload?: () => void;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <section className="rounded-xl border border-dashed p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Already Paid ({rows.length})</h3>
          <p className="text-sm text-muted-foreground">
            Info only · {formatAmount(total)} · not counted in collection
          </p>
        </div>
        {onDownload && rows.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-sm"
            onClick={onDownload}
          >
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No Already Paid cases.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div
              key={`${r.loanId}-${r.createdAt}-${i}`}
              className="rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{r.loanId || "—"}</span>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                    Already Paid
                  </span>
                </div>
                <span className="font-semibold">{formatAmount(r.amount)}</span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {r.executive} · Paid {r.date} · Allocated {r.allocationDate}
              </p>
              <p className="text-muted-foreground">Category: {r.allocationCategory || "—"}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
