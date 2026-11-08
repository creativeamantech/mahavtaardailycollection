import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { initializeMasterAllocation } from "@/lib/master-allocation.functions";
import { Button } from "@/components/ui/button";

export function MasterAllocationInitializer() {
  const initialize = useServerFn(initializeMasterAllocation);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ title: string; url: string; created: boolean } | null>(null);

  async function handleInitialize() {
    setBusy(true);
    try {
      const response = await initialize();
      setResult({ title: response.title, url: response.url, created: response.created });
      toast.success(response.created ? "Master Allocation spreadsheet created." : "This month's spreadsheet already exists. Reusing it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not initialize Master Allocation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[#f0df9e] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-[#292510]">Master Allocation Initialization</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create or open this month’s Mahavtaar Master Allocation spreadsheet. No data is uploaded or modified.</p>
        </div>
        <Button onClick={handleInitialize} disabled={busy} className="h-11 shrink-0 bg-[#f7c928] font-bold text-[#302600] hover:bg-[#e9bb17]">
          {busy ? "Initializing…" : "Initialize"}
        </Button>
      </div>
      {result && (
        <div className="mt-4 rounded-xl border border-[#f2e6bd] bg-[#fffdf5] p-3">
          <p className="text-sm font-semibold text-[#51451e]">{result.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{result.created ? "New spreadsheet created." : "Existing monthly spreadsheet found and reused."}</p>
          <a href={result.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-[#8a6b00] underline">Open Google Spreadsheet ↗</a>
        </div>
      )}
    </section>
  );
}
