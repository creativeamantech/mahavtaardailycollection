import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLivePortalStatus } from "@/lib/portal.functions";
import type { LivePortalStatus } from "@/lib/portal-types";

export function useLivePortalStatus() {
  const fetchStatus = useServerFn(getLivePortalStatus);

  const { data, refetch, isFetching } = useQuery<LivePortalStatus>({
    queryKey: ["portalLiveStatus"],
    queryFn: async () => {
      const res = await fetchStatus();
      return res as LivePortalStatus;
    },
    refetchInterval: 10_000, // Poll every 10s as safety background check
    staleTime: 5_000,
  });

  // Local second-by-second timer tick so timers tick smoothly without spamming the server
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const active = data?.activeSession;
  let elapsedSeconds = 0;
  let remainingSeconds: number | null = null;
  let isNearExpiry = false;

  if (active && active.startedAtEpochMs) {
    // Offset between client clock and server clock at time of fetch
    const nowServerEstimate = data ? tick - (tick - (data.serverTimeEpochMs || tick)) : tick;
    elapsedSeconds = Math.max(0, Math.floor((nowServerEstimate - active.startedAtEpochMs) / 1000));

    if (active.maxAllowedSeconds) {
      remainingSeconds = Math.max(0, active.maxAllowedSeconds - elapsedSeconds);
      if (remainingSeconds <= 60 && remainingSeconds > 0) {
        isNearExpiry = true;
      }
    }
  }

  return {
    status: data,
    isPortalActive: data?.isPortalActive ?? false,
    activeSession: data?.activeSession ?? null,
    currentScheduled: data?.currentScheduled ?? null,
    nextScheduled: data?.nextScheduled ?? null,
    isAnkitaBatchWindow: data?.isAnkitaBatchWindow ?? false,
    elapsedSeconds,
    remainingSeconds,
    isNearExpiry,
    refetch,
    isFetching,
  };
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
