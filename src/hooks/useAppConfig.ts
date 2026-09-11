import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DEFAULT_FLAGS,
  getAppConfig,
  type FeatureFlags,
  type Notification,
} from "@/lib/app-config.functions";

export const APP_CONFIG_KEY = ["app-config"] as const;

// One shared fetch for feature flags + notifications, reused by every page.
export function useAppConfig() {
  const fetchConfig = useServerFn(getAppConfig);
  const query = useQuery({
    queryKey: APP_CONFIG_KEY,
    queryFn: () => fetchConfig(),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const flags: FeatureFlags = { ...DEFAULT_FLAGS, ...(query.data?.flags ?? {}) };
  const notifications: Notification[] = query.data?.notifications ?? [];
  const activeNotification =
    [...notifications]
      .filter((n) => n.status.toLowerCase() !== "removed")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .pop() ?? null;

  return { ...query, flags, notifications, activeNotification };
}

export function useFeatureEnabled(key: string) {
  const { flags } = useAppConfig();
  return flags[key] !== false;
}
