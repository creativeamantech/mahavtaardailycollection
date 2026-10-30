import { createFileRoute } from "@tanstack/react-router";
import { ExcludedLoanManager } from "@/components/ExcludedLoanManager";

export const Route = createFileRoute("/_authenticated/excluded-loans")({
  head: () => ({
    meta: [
      { title: "Excluded Loan Numbers — Mahavtaar Daily Collection" },
      { name: "description", content: "Admin management of excluded loan numbers." },
    ],
  }),
  component: ExcludedLoansPage,
});

function ExcludedLoansPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Excluded Loan Numbers</h1>
        <p className="mt-1 text-sm text-muted-foreground">Admin-only management. Excluded loans remain omitted from collection reports.</p>
      </div>
      <ExcludedLoanManager />
    </main>
  );
}
