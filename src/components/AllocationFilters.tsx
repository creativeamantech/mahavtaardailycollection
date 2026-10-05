import { formatAmount } from "@/lib/executives";
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

export function uniqueCategories(rows: { allocationCategory?: string }[]) {
  return [...new Set(rows.map((r) => r.allocationCategory ?? "").filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export const ALL_CATEGORIES = "__all_categories__";

export function CategoryFilter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
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
          {options.map((c) => (
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
export function AlreadyPaidSection({ rows }: { rows: Collection[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <section className="rounded-xl border border-dashed p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">Already Paid ({rows.length})</h3>
        <p className="text-sm text-muted-foreground">
          Info only · {formatAmount(total)} · not counted in collection
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No Already Paid cases.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={`${r.loanId}-${r.createdAt}-${i}`} className="rounded-lg border p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{r.loanId || "—"}</span>
                <span className="font-semibold">{formatAmount(r.amount)}</span>
              </div>
              <p className="text-muted-foreground">
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

