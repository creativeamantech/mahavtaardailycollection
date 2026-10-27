import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sheetLoginAction, sheetGetCurrentUser } from "@/lib/sheet-auth.functions";
import type { SheetUserSafe } from "@/lib/sheet-auth.server";

export const SHEET_AUTH_TOKEN_KEY = "mahavtaar_sheet_token";
export const SHEET_AUTH_USER_KEY = "mahavtaar_sheet_user";

export function getStoredSheetToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SHEET_AUTH_TOKEN_KEY);
}

export function getStoredSheetUser(): SheetUserSafe | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SHEET_AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SheetUserSafe;
  } catch {
    return null;
  }
}

export function saveSheetSession(token: string, user: SheetUserSafe) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SHEET_AUTH_TOKEN_KEY, token);
  localStorage.setItem(SHEET_AUTH_USER_KEY, JSON.stringify(user));
  // Also store in cookie for server render if needed
  document.cookie = `${SHEET_AUTH_TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=604800; SameSite=Lax`;
}

export function clearSheetSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SHEET_AUTH_TOKEN_KEY);
  localStorage.removeItem(SHEET_AUTH_USER_KEY);
  document.cookie = `${SHEET_AUTH_TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
}

interface SheetAuthContextValue {
  user: SheetUserSafe | null;
  token: string | null;
  isLoading: boolean;
  login: (identifier: string, pin: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const SheetAuthContext = createContext<SheetAuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  login: async () => ({ success: false }),
  logout: () => {},
  refreshUser: async () => {},
});

export function SheetAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(getStoredSheetToken);
  const [user, setUser] = useState<SheetUserSafe | null>(getStoredSheetUser);
  const [isLoading, setIsLoading] = useState(true);

  const getCurrentUserFn = useServerFn(sheetGetCurrentUser);
  const loginFn = useServerFn(sheetLoginAction);

  async function verifyCurrentSession(tok: string | null) {
    if (!tok) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const res = await getCurrentUserFn({ data: { token: tok } });
      if (res && res.user) {
        setUser(res.user);
        saveSheetSession(tok, res.user);
      } else {
        clearSheetSession();
        setUser(null);
        setToken(null);
      }
    } catch (e) {
      console.warn("Session check error:", e);
      // Keep cached user if offline, but if explicit rejection occurred clear
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const storedTok = getStoredSheetToken();
    setToken(storedTok);
    verifyCurrentSession(storedTok);
  }, []);

  const login = async (identifier: string, pin: string) => {
    setIsLoading(true);
    try {
      const res = await loginFn({ data: { identifier, pin } });
      if (res.success && res.token && res.user) {
        saveSheetSession(res.token, res.user);
        setToken(res.token);
        setUser(res.user);
        setIsLoading(false);
        return { success: true };
      }
      setIsLoading(false);
      return { success: false, error: res.error || "Login failed" };
    } catch (err: unknown) {
      setIsLoading(false);
      const msg = err instanceof Error ? err.message : "Authentication error occurred.";
      return { success: false, error: msg };
    }
  };

  const logout = () => {
    clearSheetSession();
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    const currentTok = getStoredSheetToken();
    await verifyCurrentSession(currentTok);
  };

  return (
    <SheetAuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </SheetAuthContext.Provider>
  );
}

export function useSheetAuth() {
  return useContext(SheetAuthContext);
}
