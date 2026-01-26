import React from "react";

export type ThemeSetting = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const storageKey = "rikugan:theme";

function isThemeSetting(value: string | null): value is ThemeSetting {
  return value === "system" || value === "light" || value === "dark";
}

function getPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): ResolvedTheme {
  if (setting === "system") return prefersDark ? "dark" : "light";
  return setting;
}

export function getInitialTheme(): ThemeSetting {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(storageKey);
  return isThemeSetting(stored) ? stored : "system";
}

export function applyTheme(theme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

export function initializeTheme() {
  const setting = getInitialTheme();
  applyTheme(resolveTheme(setting, getPrefersDark()));
}

export function useTheme() {
  const [setting, setSetting] = React.useState<ThemeSetting>(() => getInitialTheme());
  const [prefersDark, setPrefersDark] = React.useState(() => getPrefersDark());

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const handler = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };

    if (media.addEventListener) {
      media.addEventListener("change", handler);
    } else {
      media.addListener(handler);
    }

    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", handler);
      } else {
        media.removeListener(handler);
      }
    };
  }, []);

  const resolvedTheme = React.useMemo(
    () => resolveTheme(setting, prefersDark),
    [setting, prefersDark]
  );

  React.useEffect(() => {
    applyTheme(resolvedTheme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, setting);
    }
  }, [resolvedTheme, setting]);

  return { theme: setting, resolvedTheme, setTheme: setSetting };
}
