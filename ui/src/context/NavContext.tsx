import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { workspaceOf, type PageId, type WorkspaceKey } from "@/nav/tree";

const LAST_PAGE_KEY = "qs.nav.lastPage";

type NavContextValue = {
  workspace: WorkspaceKey;
  page: PageId;
  /** 跳到指定页面（自动解析工作区） */
  goTo: (page: PageId) => void;
  navigate: (workspace: WorkspaceKey, page: PageId) => void;
};

const NavContext = createContext<NavContextValue | null>(null);

function rememberLastPage(ws: WorkspaceKey, page: PageId) {
  try {
    const raw = localStorage.getItem(LAST_PAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[ws] = page;
    localStorage.setItem(LAST_PAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function NavProvider({
  workspace,
  page,
  onNavigate,
  children,
}: {
  workspace: WorkspaceKey;
  page: PageId;
  onNavigate: (workspace: WorkspaceKey, page: PageId) => void;
  children: ReactNode;
}) {
  const navigate = useCallback(
    (ws: WorkspaceKey, next: PageId) => {
      rememberLastPage(ws, next);
      onNavigate(ws, next);
    },
    [onNavigate]
  );

  const goTo = useCallback(
    (next: PageId) => {
      navigate(workspaceOf(next), next);
    },
    [navigate]
  );

  const value = useMemo(
    () => ({ workspace, page, goTo, navigate }),
    [workspace, page, goTo, navigate]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavProvider");
  return ctx;
}
