import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getCollectionApprovalRequests, decideCollectionApproval } from "@/lib/mahavtaar.functions";

type ApprovalRequest = {
  row: number;
  createdAt: string;
  requestedBy: string;
  allocatedExecutive: string;
  loanId: string;
  emi: number;
  pos: number;
  amount: number;
};

export function CollectionApprovalsPanel() {
  const getRequests = useServerFn(getCollectionApprovalRequests);
  const decide = useServerFn(decideCollectionApproval);
  const qc = useQueryClient();
  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["collection-approval-requests"],
    queryFn: () => getRequests() as Promise<ApprovalRequest[]>,
    refetchInterval: 30_000,
  });

  async function handleDecision(row: number, decision: "APPROVE" | "REJECT") {
    try {
      await decide({ data: { row, decision, note: "" } as never });
      toast.success(decision === "APPROVE" ? "Collection approved and saved." : "Request rejected.");
      await refetch();
      qc.invalidateQueries({ queryKey: ["collections"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not process approval.");
    }
  }

  if (isLoading) return <div className="mt-6 rounded-xl border p-4 text-sm text-muted-foreground">Loading approval requests…</div>;

  return (
    <section className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Pending Collection Approvals</h2>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Refresh</Button>
      </div>
      {data.length === 0 ? (
        <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No pending approval requests.</div>
      ) : data.map((request) => (
        <article key={request.row} className="space-y-3 rounded-xl border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Loan ID: {request.loanId}</p>
              <p className="text-sm text-muted-foreground">Requested by {request.requestedBy}</p>
            </div>
            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">Pending</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <p>Allocated to: <strong>{request.allocatedExecutive}</strong></p>
            <p>Entry amount: <strong>₹{request.amount.toLocaleString("en-IN")}</strong></p>
            <p>EMI: ₹{request.emi.toLocaleString("en-IN")}</p>
            <p>POS: ₹{request.pos.toLocaleString("en-IN")}</p>
          </div>
          <p className="text-xs text-muted-foreground">Requested: {request.createdAt ? new Date(request.createdAt).toLocaleString("en-IN") : "—"}</p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => handleDecision(request.row, "APPROVE")}>Approve & Save</Button>
            <Button className="flex-1" variant="destructive" onClick={() => handleDecision(request.row, "REJECT")}>Reject</Button>
          </div>
        </article>
      ))}
    </section>
  );
}
