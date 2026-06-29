import { create } from "zustand";
import { persist } from "zustand/middleware";

function decodeUserId(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const json = atob(padded);
    const payload = JSON.parse(json) as { userId?: string };
    return payload.userId ?? null;
  } catch {
    return null;
  }
}

interface AuthState {
  token: string | null;
  userId: string | null;
  hydrated: boolean;
  login: (token: string) => void;
  logout: () => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      hydrated: false,
      login: (token: string) => set({ token, userId: decodeUserId(token) }),
      logout: () => set({ token: null, userId: null }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "perps-auth",
      partialize: (s) => ({ userId: s.userId }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    }
  )
);
