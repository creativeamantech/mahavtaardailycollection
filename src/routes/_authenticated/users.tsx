import { createFileRoute } from "@tanstack/react-router";
import { PasswordGate } from "@/components/PasswordGate";
import { SheetUserManager } from "@/components/SheetUserManager";
import { useSheetAuth } from "@/hooks/useSheetAuth";

export const Route = createFileRoute("/_authenticated/users")({
  component: UsersPage,
});

function UsersPage() {
  const { user } = useSheetAuth();
  const isAdmin = user?.role === "Admin";

  const content = (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Users Management</h1>
        <p className="text-sm text-muted-foreground">
          Manage Daily Collection executives, hashed PINs, roles, and active status in the{" "}
          <strong>Users</strong> tab of the Google Sheet.
        </p>
      </div>

      <SheetUserManager />
    </main>
  );

  // If logged in as an Admin via Google Sheet Auth, allow direct management; otherwise require Settings password
  if (isAdmin) {
    return content;
  }

  return <PasswordGate title="Users Management (Admin Only)">{content}</PasswordGate>;
}
