import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, LogOut, Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import type { CrmNavItem } from "@/components/navRegistry";

interface QuickCommandSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceItems: readonly CrmNavItem[];
  adminItems: readonly CrmNavItem[];
  currentPathname: string;
  onSignOut: () => void;
}

export function QuickCommandSearch({
  open,
  onOpenChange,
  workspaceItems,
  adminItems,
  currentPathname,
  onSignOut,
}: QuickCommandSearchProps) {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  function goTo(to: string) {
    onOpenChange(false);
    void navigate({ to: to as never });
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to any CRM page, reconciliation view, or action…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No matching CRM workspace or action found.</CommandEmpty>

        <CommandGroup heading="Workspace Pages">
          {workspaceItems.map((item) => {
            const Icon = item.icon;
            const active = currentPathname === item.to;
            return (
              <CommandItem
                key={item.to}
                value={`${item.label} ${item.description} ${(item.keywords ?? []).join(" ")}`}
                onSelect={() => goTo(item.to)}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-lg border ${
                      active
                        ? "border-[#edd068] bg-[#fef8e2] text-[#5d2172]"
                        : "border-border bg-muted/60 text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="truncate">{item.label}</span>
                      {active && (
                        <span className="text-[10px] font-bold text-[#5d2172]">Current</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </CommandItem>
            );
          })}
        </CommandGroup>

        {adminItems.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Administration & Reconciliation">
              {adminItems.map((item) => {
                const Icon = item.icon;
                const active = currentPathname === item.to;
                return (
                  <CommandItem
                    key={item.to}
                    value={`${item.label} ${item.description} ${(item.keywords ?? []).join(" ")}`}
                    onSelect={() => goTo(item.to)}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`grid size-8 shrink-0 place-items-center rounded-lg border ${
                          active
                            ? "border-[#edd068] bg-[#fef8e2] text-[#5d2172]"
                            : "border-border bg-muted/60 text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className="truncate">{item.label}</span>
                          {active && (
                            <span className="text-[10px] font-bold text-[#5d2172]">Current</span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                      </div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Session">
          <CommandItem
            value="sign out logout exit workspace"
            onSelect={() => {
              onOpenChange(false);
              onSignOut();
            }}
            className="flex items-center justify-between gap-3 py-2.5 text-destructive"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive">
                <LogOut className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold">Sign out of workspace</span>
            </div>
            <CommandShortcut>Session</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export function QuickSearchTriggerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open quick command search"
      className="group inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 text-xs text-muted-foreground transition-colors hover:border-[#c9b3dc] hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-[220px] sm:justify-between sm:px-3"
    >
      <span className="flex items-center gap-2 truncate whitespace-nowrap">
        <Search className="h-3.5 w-3.5 shrink-0 text-[#6e287f]" />
        <span className="hidden sm:inline">Search CRM pages…</span>
        <span className="sm:hidden">Search</span>
      </span>
      <kbd className="hidden rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground group-hover:text-foreground md:inline-block">
        ⌘K
      </kbd>
    </button>
  );
}
