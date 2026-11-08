import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getNotificationReadState,
  markNotificationSeen,
} from "@/lib/app-config.functions";

export const NOTIFICATION_READS_KEY = ["notification-reads"] as const;

export function useNotificationReads() {
  const queryClient = useQueryClient();
  const fetchState = useServerFn(getNotificationReadState);
  const saveSeen = useServerFn(markNotificationSeen);

  const query = useQuery({
    queryKey: NOTIFICATION_READS_KEY,
    queryFn: () => fetchState(),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  async function markSeen(notificationId: string) {
    await saveSeen({ data: { notificationId } });
    await queryClient.invalidateQueries({ queryKey: NOTIFICATION_READS_KEY });
  }

  return {
    ...query,
    currentUser: query.data?.currentUser ?? "",
    role: query.data?.role ?? "Executive",
    reads: query.data?.reads ?? [],
    executives: query.data?.executives ?? [],
    markSeen,
  };
}
