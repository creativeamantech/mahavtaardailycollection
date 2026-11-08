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
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const flags: FeatureFlags = { ...DEFAULT_FLAGS, ...(query.data?.flags ?? {}) };
  const notifications: Notification[] = query.data?.notifications ?? [];
  const defaultCategory = query.data?.defaultCategory ?? "";
  const session = query.data?.session ?? null;
  const executiveName = session?.role === "Executive" ? session.name : "";
  const isPriority = (text: string) => {
    if (!executiveName) return false;
    const normalizedText = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    const normalizedName = executiveName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return normalizedName.length > 0 && normalizedText.includes(` ${normalizedName} `);
  };
  const activeNotification =
    [...notifications]
      .filter((n) => n.status.toLowerCase() !== "removed")
      .sort((a, b) => Number(isPriority(b.text)) - Number(isPriority(a.text)) || b.createdAt.localeCompare(a.createdAt))[0] ?? null;

  return {
    ...query,
    flags,
    notifications,
    activeNotification,
    defaultCategory,
    session,
    holdCasesLocked: query.data?.holdCasesLocked ?? false,
  };
}

export function useFeatureEnabled(key: string) {
  const { flags } = useAppConfig();
  return flags[key] !== false;
}
