import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type SavedPosition = { x: number; y: number; hidden: "left" | "right" | null };
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

const STORAGE_KEY = "mahavtaar-mobile-nav-position";
const BUTTON_SIZE = 48;
const EDGE_VISIBLE = 14;
const DRAG_THRESHOLD = 6;

export function DraggableMobileNavButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const [position, setPosition] = useState<SavedPosition | null>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as SavedPosition;
      if (
        Number.isFinite(parsed.x) &&
        Number.isFinite(parsed.y) &&
        (parsed.hidden === null || parsed.hidden === "left" || parsed.hidden === "right")
      ) {
        const x = Math.max(0, Math.min(parsed.x, window.innerWidth - BUTTON_SIZE));
        const y = Math.max(0, Math.min(parsed.y, window.innerHeight - BUTTON_SIZE));
        // Migrate legacy bottom-right placements that overlap the Lovable edit badge.
        // Keep other intentionally saved positions and edge-snapped placements unchanged.
        const overlapsLovableBadge =
          x > window.innerWidth / 2 &&
          y > window.innerHeight - BUTTON_SIZE - 180;
        setPosition(
          overlapsLovableBadge
            ? {
                x: 16,
                y: Math.max(16, window.innerHeight - BUTTON_SIZE - 16),
                hidden: null,
              }
            : { x, y, hidden: parsed.hidden },
        );
      }
    } catch {
      // Ignore unavailable storage or invalid saved coordinates.
    }
  }, []);

  useEffect(() => {
    if (!position) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    } catch {
      // Navigation remains usable when storage is unavailable.
    }
  }, [position]);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: position?.y ?? rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    active.moved = true;
    suppressClick.current = true;
    setPosition({
      x: Math.max(0, Math.min(active.originX + dx, window.innerWidth - BUTTON_SIZE)),
      y: Math.max(0, Math.min(active.originY + dy, window.innerHeight - BUTTON_SIZE)),
      hidden: null,
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!active.moved) return;

    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    const x = Math.max(0, Math.min(active.originX + dx, window.innerWidth - BUTTON_SIZE));
    const y = Math.max(0, Math.min(active.originY + dy, window.innerHeight - BUTTON_SIZE));
    const nearLeft = x <= 22;
    const nearRight = window.innerWidth - (x + BUTTON_SIZE) <= 22;
    const hidden = nearLeft ? "left" : nearRight ? "right" : null;

    setPosition({
      x: hidden === "left" ? 0 : hidden === "right" ? window.innerWidth - BUTTON_SIZE : x,
      y,
      hidden,
    });
  }

  function handleClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (position?.hidden) {
      setPosition({ ...position, hidden: null });
      return;
    }
    onToggle();
  }

  // Keep the control anchored onscreen even before saved-position hydration.
  // Without explicit inset coordinates, a fixed element at the end of the app shell
  // can use its static position and appear below the visible viewport.
  const positionStyle = position
    ? {
        left: position.x,
        top: position.y,
        right: "auto" as const,
        bottom: "auto" as const,
        transform:
          position.hidden === "left"
            ? `translateX(calc(-100% + ${EDGE_VISIBLE}px))`
            : position.hidden === "right"
              ? `translateX(calc(100% - ${EDGE_VISIBLE}px))`
              : "none",
      }
    : {
        left: 16,
        top: "auto" as const,
        right: "auto" as const,
        bottom: "calc(16px + env(safe-area-inset-bottom))",
        transform: "none",
      };

  return (
    <button
      type="button"
      aria-label={position?.hidden ? "Show navigation button" : open ? "Close navigation menu" : "Open navigation menu"}
      aria-expanded={open}
      aria-controls="global-mobile-navigation"
      title={position?.hidden ? "Tap to show navigation" : "Drag to move · Tap to open navigation"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
      style={positionStyle}
      className={`fixed z-[10000] grid size-12 touch-none select-none place-items-center rounded-xl border border-[#26313d] bg-[#101722] text-2xl text-white shadow-lg transition-[background-color,transform] hover:bg-[#202b39] active:scale-95 md:hidden print:hidden ${position?.hidden ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
    >
      <span aria-hidden="true">
        {position?.hidden === "left" ? "›" : position?.hidden === "right" ? "‹" : open ? "×" : "☰"}
      </span>
    </button>
  );
}
