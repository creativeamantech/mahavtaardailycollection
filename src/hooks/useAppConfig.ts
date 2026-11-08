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
export function useAppConfig(options: { enabled?: boolean } = {}) {
  const fetchConfig = useServerFn(getAppConfig);
  const query = useQuery({
    queryKey: APP_CONFIG_KEY,
    queryFn: () => fetchConfig(),
    enabled: options.enabled ?? true,
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const flags: FeatureFlags = { ...DEFAULT_FLAGS, ...(query.data?.flags ?? {}) };
  const notifications: Notification[] = query.data?.notifications ?? [];
  const defaultCategory = query.data?.defaultCategory ?? "";\n  const session = query.data?.session ?? null;
  const activeNotification =
    [...notifications]
      .filter((n) => n.status.toLowerCase() !== "removed")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .pop() ?? null;

  return {
    ...query,
    flags,
    notifications,
    activeNotification,
    defaultCategory,
    holdCasesLocked: query.data?.holdCasesLocked ?? false,
  };
}

export function useFeatureEnabled(key: string) {
  const { flags } = useAppConfig();
  return flags[key] !== false;
}
