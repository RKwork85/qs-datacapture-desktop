export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "qs-theme";

export function getStoredTheme(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

export function storeTheme(mode: ThemeMode) {
  localStorage.setItem(STORAGE_KEY, mode);
}

export function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyThemeClass(mode: ThemeMode) {
  const dark = resolveDark(mode);
  document.documentElement.classList.toggle("dark", dark);
  // 同步原生窗口底色，减轻无边框缩放时的黑边
  const bg = dark ? "#0f172a" : "#f5f8ff";
  void window.qsApi?.setWindowBackground?.(bg);
  return dark;
}
