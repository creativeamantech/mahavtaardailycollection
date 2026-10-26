import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  DEFAULT_SCHEDULES,
  type ExecutiveSchedule,
  type PortalExecutive,
  type TimeSlot,
  ANKITA_BATCH_WINDOW,
} from "@/lib/portal-types";
import { getPortalReports, savePortalSchedules } from "@/lib/portal.functions";
import { useLivePortalStatus } from "@/hooks/useLivePortalStatus";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Edit3, Plus, ShieldCheck, Trash2 } from "lucide-react";

interface Props {
  currentExecutive: PortalExecutive;
  adminPassword?: string;
}

export function ExecutiveScheduleView({ currentExecutive, adminPassword }: Props) {
  const qc = useQueryClient();
  const { currentScheduled } = useLivePortalStatus();
  const fetchReports = useServerFn(getPortalReports);
  const saveSchedulesFn = useServerFn(savePortalSchedules);

  const { data } = useQuery({
    queryKey: ["portalReports"],
    queryFn: async () => {
      const res = await fetchReports();
      return res;
    },
    staleTime: 15_000,
  });

  // Safe schedule normalization guaranteeing every executive has a valid slots array
  const schedules: ExecutiveSchedule[] = useMemo(() => {
    const raw = data?.schedules;
    return DEFAULT_SCHEDULES.map((def) => {
      const found = Array.isArray(raw)
        ? raw.find((s) => s && s.executive === def.executive)
        : undefined;
      const validSlots: TimeSlot[] =
        Array.isArray(found?.slots) && found.slots.length > 0 ? found.slots : def.slots;
      return {
        executive: def.executive,
        isAvailable: found?.isAvailable ?? def.isAvailable ?? true,
        notes: found?.notes ?? def.notes,
        slots: validSlots,
      };
    });
  }, [data?.schedules]);

  // Edit Schedule Modal State (Admin only)
  const [isEditing, setIsEditing] = useState(false);
  const [draftSchedules, setDraftSchedules] = useState<ExecutiveSchedule[]>([]);
  const [selectedExecForEdit, setSelectedExecForEdit] = useState<PortalExecutive>("Aarti");
  const [isSaving, setIsSaving] = useState(false);

  const openEditor = () => {
    if (currentExecutive !== "Aman" && !adminPassword) {
      toast.error("Only administrator Aman can edit schedules and availability.");
      return;
    }
    setDraftSchedules(
      schedules.map((s) => ({
        ...s,
        slots: Array.isArray(s.slots)
          ? s.slots.map((sl) => ({ ...sl }))
          : (DEFAULT_SCHEDULES.find((d) => d.executive === s.executive)?.slots ?? []),
      })),
    );
    setIsEditing(true);
  };

  const handleSaveSchedules = async () => {
    setIsSaving(true);
    try {
      await saveSchedulesFn({
        data: {
          adminPassword: adminPassword || "Mahadev@Babaji@0003",
          schedules: draftSchedules,
          adminActor: currentExecutive,
        },
      });

      toast.success("Executive schedules and availability saved successfully!");
      setIsEditing(false);
      await qc.invalidateQueries({ queryKey: ["portalReports"] });
      await qc.invalidateQueries({ queryKey: ["portalLiveStatus"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save schedules.");
    } finally {
      setIsSaving(false);
    }
  };

  const addSlot = (exec: PortalExecutive) => {
    setDraftSchedules((prev) =>
      prev.map((s) => {
        if (s.executive !== exec) return s;
        const currentSlots = Array.isArray(s.slots) ? s.slots : [];
        return {
          ...s,
          slots: [...currentSlots, { start: "12:00", end: "12:30", label: "12:00–12:30 PM" }],
        };
      }),
    );
  };

  const removeSlot = (exec: PortalExecutive, slotIdx: number) => {
    setDraftSchedules((prev) =>
      prev.map((s) => {
        if (s.executive !== exec) return s;
        const currentSlots = Array.isArray(s.slots) ? s.slots : [];
        return {
          ...s,
          slots: currentSlots.filter((_, i) => i !== slotIdx),
        };
      }),
    );
  };

  const updateSlot = (
    exec: PortalExecutive,
    slotIdx: number,
    field: "start" | "end" | "label",
    value: string,
  ) => {
    setDraftSchedules((prev) =>
      prev.map((s) => {
        if (s.executive !== exec) return s;
        const newSlots = [...(Array.isArray(s.slots) ? s.slots : [])];
        if (newSlots[slotIdx]) {
          newSlots[slotIdx] = { ...newSlots[slotIdx]!, [field]: value };
        }
        return { ...s, slots: newSlots };
      }),
    );
  };

  const toggleAvailability = (exec: PortalExecutive, available: boolean) => {
    setDraftSchedules((prev) =>
      prev.map((s) => (s.executive === exec ? { ...s, isAvailable: available } : s)),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Executive Portal Schedule (Asia/Kolkata IST)</h3>
          <p className="text-xs text-muted-foreground">
            Strict assigned time slots. Outside your slot, access defaults to 7m 15s temporary
            window.
          </p>
        </div>

        {currentExecutive === "Aman" && (
          <Button onClick={openEditor} variant="outline" size="sm" className="gap-1.5 h-9">
            <Edit3 className="h-3.5 w-3.5" />
            Edit Schedules & Availability
          </Button>
        )}
      </div>

      {/* Ankita Batch Window Highlight Box */}
      <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-3.5 dark:border-purple-900 dark:bg-purple-950/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-600 text-white font-bold text-xs">
              ★
            </span>
            <span className="font-bold text-sm text-purple-900 dark:text-purple-200">
              Ankita's Dedicated Batch Handling Window
            </span>
          </div>
          <Badge
            variant="outline"
            className="border-purple-400 bg-purple-100 text-purple-900 font-mono text-xs"
          >
            {ANKITA_BATCH_WINDOW.label}
          </Badge>
        </div>
        <p className="mt-1.5 text-xs text-purple-800/90 dark:text-purple-300">
          Reserved exclusively for Ankita. During this window, other executives' queries are
          recorded immediately and queued without popups or sound disruptions. Regular query
          notifications resume after 7:30 PM.
        </p>
      </div>

      {/* Timetable of All 8 Executives */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="border-b bg-muted/60 text-muted-foreground font-semibold">
            <tr>
              <th className="p-3">Executive</th>
              <th className="p-3">Status</th>
              <th className="p-3">Slot 1 (Morning / Early Afternoon)</th>
              <th className="p-3">Slot 2 / Additional Slots (Afternoon / Evening)</th>
              <th className="p-3 text-right">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {schedules.map((s, idx) => {
              const isCurrentExec = currentScheduled?.executive === s.executive;
              const slots = Array.isArray(s.slots) ? s.slots : [];
              const firstSlot = slots[0];
              const remainingSlots = slots.slice(1);

              return (
                <tr
                  key={`sched-row-${s.executive}-${idx}`}
                  className={`transition-colors ${
                    isCurrentExec
                      ? "bg-emerald-50/80 font-medium dark:bg-emerald-950/30"
                      : "hover:bg-muted/30"
                  }`}
                >
                  <td className="p-3 font-semibold flex items-center gap-2">
                    <span>{s.executive}</span>
                    {s.executive === "Aman" && (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                        Admin
                      </Badge>
                    )}
                    {isCurrentExec && (
                      <Badge className="bg-emerald-600 text-white text-[10px] py-0 px-1.5 animate-pulse">
                        Active Slot
                      </Badge>
                    )}
                  </td>
                  <td className="p-3">
                    {s.isAvailable ? (
                      <span className="inline-flex items-center text-xs text-emerald-700 dark:text-emerald-400">
                        ● Available
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs text-destructive">
                        ○ Unavailable
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {firstSlot ? (
                      <span className="rounded bg-muted px-2 py-1 font-mono text-xs">
                        {firstSlot.label || `${firstSlot.start}–${firstSlot.end}`}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {remainingSlots.map((sl, i) => (
                        <span key={i} className="rounded bg-muted px-2 py-1 font-mono text-xs">
                          {sl.label || `${sl.start}–${sl.end}`}
                        </span>
                      ))}
                      {remainingSlots.length === 0 && "—"}
                    </div>
                  </td>
                  <td className="p-3 text-right text-xs text-muted-foreground">
                    {s.notes || "Standard Schedule"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Admin Edit Schedule Dialog */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-purple-600" />
              Manage Schedules & Executive Availability
            </DialogTitle>
            <DialogDescription>
              Aman can configure multiple slots per executive, toggle availability, and configure
              exceptions.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-4">
            <div className="flex flex-wrap gap-1 border-b pb-3">
              {draftSchedules.map((s, idx) => {
                const count = Array.isArray(s.slots) ? s.slots.length : 0;
                return (
                  <button
                    key={`draft-btn-${s.executive}-${idx}`}
                    type="button"
                    onClick={() => setSelectedExecForEdit(s.executive)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                      selectedExecForEdit === s.executive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {s.executive} ({count})
                  </button>
                );
              })}
            </div>

            {/* Editor for chosen executive */}
            {draftSchedules
              .filter((s) => s.executive === selectedExecForEdit)
              .map((s, idx) => {
                const slots = Array.isArray(s.slots) ? s.slots : [];
                return (
                  <div
                    key={`draft-edit-${s.executive}-${idx}`}
                    className="space-y-4 rounded-xl border p-4 bg-card"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-base">{s.executive}'s Assigned Slots</h4>
                        <p className="text-xs text-muted-foreground">Time format 24-hour (HH:MM)</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`avail-${s.executive}`}
                          checked={s.isAvailable}
                          onCheckedChange={(checked) =>
                            toggleAvailability(s.executive, checked === true)
                          }
                        />
                        <Label htmlFor={`avail-${s.executive}`} className="text-xs font-semibold">
                          Available Today
                        </Label>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {slots.map((slot, idx) => (
                        <div
                          key={idx}
                          className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 bg-muted/30"
                        >
                          <div className="w-24">
                            <Label className="text-[10px] text-muted-foreground">Start</Label>
                            <Input
                              type="time"
                              value={slot.start}
                              onChange={(e) =>
                                updateSlot(s.executive, idx, "start", e.target.value)
                              }
                              className="h-9 font-mono text-xs"
                            />
                          </div>
                          <div className="w-24">
                            <Label className="text-[10px] text-muted-foreground">End</Label>
                            <Input
                              type="time"
                              value={slot.end}
                              onChange={(e) => updateSlot(s.executive, idx, "end", e.target.value)}
                              className="h-9 font-mono text-xs"
                            />
                          </div>
                          <div className="flex-1 min-w-[140px]">
                            <Label className="text-[10px] text-muted-foreground">
                              Display Label
                            </Label>
                            <Input
                              value={slot.label}
                              onChange={(e) =>
                                updateSlot(s.executive, idx, "label", e.target.value)
                              }
                              placeholder="e.g. 10:00–10:29 AM"
                              className="h-9 text-xs"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeSlot(s.executive, idx)}
                            className="h-9 w-9 text-destructive hover:bg-destructive/10 mt-3"
                            title="Delete slot"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addSlot(s.executive)}
                        className="w-full text-xs h-9 gap-1"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Slot for {s.executive}
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSchedules} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save All Schedules"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
