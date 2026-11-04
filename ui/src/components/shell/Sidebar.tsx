import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { ChevronDown, Megaphone, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { brandIcons, type BrandKey } from "@/assets/brands";
import dataCenterIcon from "@/assets/icons/data-center.svg";
import controlCenterIcon from "@/assets/icons/control-center.svg";
import {
  NAV_TREE,
  defaultPageFor,
  type NavKey,
  type PageId,
  type WorkspaceKey,
} from "@/nav/tree";
import { cn } from "@/lib/utils";
import { useDocPanel } from "@/context/DocPanelContext";
import { emitToast } from "@/components/ui/toast";

export type { NavKey, PageId, WorkspaceKey };

const ICON_BOX = "h-5 w-5";
const EXPAND_KEY = "qs.nav.expanded";
const LAST_PAGE_KEY = "qs.nav.lastPage";
const TRANSITION = "transition-colors duration-[150ms] ease";
const SIDEBAR_W = 232;
const SIDEBAR_W_COLLAPSED = 64;

type ExpandMap = Record<WorkspaceKey, boolean>;
type LastPageMap = Partial<Record<WorkspaceKey, PageId>>;

const ALL_CLOSED: ExpandMap = {
  dy: false,
  xhs: false,
  weibo: false,
  data: false,
  control: false,
};

function loadExpand(): ExpandMap {
  const fallback: ExpandMap = {
    dy: true,
    xhs: false,
    weibo: false,
    data: false,
    control: false,
  };
  try {
    const raw = localStorage.getItem(EXPAND_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function saveExpand(map: ExpandMap) {
  try {
    localStorage.setItem(EXPAND_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function loadLastPages(): LastPageMap {
  try {
    const raw = localStorage.getItem(LAST_PAGE_KEY);
    const map = raw ? (JSON.parse(raw) as LastPageMap) : {};
    if ((map.control as string) === "control.login") {
      map.control = "control.tasks";
    }
    return map;
  } catch {
    return {};
  }
}

function saveLastPages(map: LastPageMap) {
  try {
    localStorage.setItem(LAST_PAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function NavGlyph({
  brand,
  workspace,
  active,
}: {
  brand?: BrandKey;
  workspace: WorkspaceKey;
  active: boolean;
}) {
  if (brand) {
    return (
      <img
        src={brandIcons[brand]}
        alt=""
        aria-hidden
        draggable={false}
        className={cn(
          ICON_BOX,
          "shrink-0 rounded-[5px] object-cover",
          TRANSITION,
          active ? "opacity-100 grayscale-0" : "opacity-75 grayscale"
        )}
      />
    );
  }

  if (workspace === "data" || workspace === "control") {
    const src = workspace === "control" ? controlCenterIcon : dataCenterIcon;
    return (
      <span
        className={cn(
          ICON_BOX,
          "relative inline-flex shrink-0 items-center justify-center overflow-visible"
        )}
      >
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          className={cn(
            "h-[28px] w-[28px] max-w-none object-contain",
            TRANSITION,
            active ? "opacity-100 grayscale-0" : "opacity-75 grayscale"
          )}
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        ICON_BOX,
        "inline-flex shrink-0 items-center justify-center rounded-[5px]",
        TRANSITION,
        active ? "bg-[#475569] text-white" : "bg-[#e2e8f0] text-[#475569]"
      )}
    />
  );
}

/**
 * 左侧工作台：手风琴二级；右下角图标可动态收缩/展开
 */
export function Sidebar({
  workspace,
  page,
  onNavigate,
  busy,
  collapsed,
  collapseEnabled,
  onToggleCollapse,
  onToggleCollapseFeature,
}: {
  workspace: WorkspaceKey;
  page: PageId;
  onNavigate: (workspace: WorkspaceKey, page: PageId) => void;
  busy: boolean;
  collapsed: boolean;
  collapseEnabled: boolean;
  onToggleCollapse: () => void;
  onToggleCollapseFeature: () => void;
}) {
  const { showStart } = useDocPanel();
  const [expanded, setExpanded] = useState<ExpandMap>(() => loadExpand());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onSettings = () => {
      setMenuOpen(false);
      showStart();
    };
    window.addEventListener("qs:open-settings", onSettings);
    return () => window.removeEventListener("qs:open-settings", onSettings);
  }, [showStart]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const [lastPages, setLastPages] = useState<LastPageMap>(() => loadLastPages());

  const rememberPage = useCallback((ws: WorkspaceKey, next: PageId) => {
    setLastPages((prev) => {
      const map = { ...prev, [ws]: next };
      saveLastPages(map);
      return map;
    });
  }, []);

  const setOnlyOpen = useCallback((key: WorkspaceKey | null, open: boolean) => {
    setExpanded(() => {
      const next: ExpandMap = { ...ALL_CLOSED };
      if (key && open) next[key] = true;
      saveExpand(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!collapsed) setOnlyOpen(workspace, true);
  }, [workspace, setOnlyOpen, collapsed]);

  useEffect(() => {
    rememberPage(workspace, page);
  }, [page, workspace, rememberPage]);

  const toggleGroup = useCallback(
    (key: WorkspaceKey) => {
      const willOpen = !expanded[key];
      setOnlyOpen(key, willOpen);
      if (willOpen) {
        const target = lastPages[key] ?? defaultPageFor(key);
        rememberPage(key, target);
        onNavigate(key, target);
      }
    },
    [expanded, lastPages, onNavigate, rememberPage, setOnlyOpen]
  );

  const goChild = useCallback(
    (ws: WorkspaceKey, child: PageId) => {
      rememberPage(ws, child);
      onNavigate(ws, child);
      setOnlyOpen(ws, true);
    },
    [onNavigate, rememberPage, setOnlyOpen]
  );

  return (
    <aside
      data-qs-sidebar
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-[#f1f5f9] bg-white",
        "transition-[width] duration-200 ease-out"
      )}
      style={{ width: collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W }}
    >
      <div className={cn("pb-2 pt-10", collapsed ? "px-1.5 text-center" : "px-3")}>
        {!collapsed ? (
          <div
            className="px-2 font-bold text-[#94a3b8]"
            style={{ fontSize: 11, letterSpacing: "0.05em" }}
          >
            工作台
          </div>
        ) : (
          <div className="mx-auto h-1 w-1 rounded-full bg-[#e2e8f0]" />
        )}
      </div>

      <nav
        className={cn(
          "scroll-thin flex flex-1 flex-col gap-1 overflow-y-auto pb-2",
          collapsed ? "px-1.5" : "px-2.5"
        )}
      >
        {NAV_TREE.map((group) => {
          const isWs = workspace === group.key;
          const isOpen = !collapsed && !!expanded[group.key];
          return (
            <div key={group.key} className="flex flex-col">
              <button
                type="button"
                title={group.label}
                aria-expanded={isOpen}
                onClick={() => {
                  if (collapsed) {
                    const target = lastPages[group.key] ?? defaultPageFor(group.key);
                    rememberPage(group.key, target);
                    onNavigate(group.key, target);
                    return;
                  }
                  toggleGroup(group.key);
                }}
                className={cn(
                  "relative flex h-9 cursor-pointer items-center rounded-md text-left",
                  TRANSITION,
                  "hover:bg-[#f8fafc]",
                  collapsed ? "w-full justify-center px-0" : "w-full gap-2.5 px-2.5",
                  isWs || isOpen ? "text-[var(--text-primary)]" : "text-[#64748b]"
                )}
              >
                <NavGlyph
                  brand={group.brand}
                  workspace={group.key}
                  active={isWs || isOpen}
                />
                {!collapsed && (
                  <>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate leading-none",
                        isWs ? "font-semibold text-[var(--text-primary)]" : "font-medium"
                      )}
                      style={{ fontSize: 13.5 }}
                    >
                      {group.label}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-[#94a3b8] transition-transform duration-150",
                        isOpen ? "rotate-0" : "-rotate-90"
                      )}
                    />
                  </>
                )}
              </button>

              {!collapsed && (
                <div
                  className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-150",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  )}
                  aria-hidden={!isOpen}
                >
                  <div className="min-h-0 overflow-hidden">
                    {isOpen ? (
                      <div className="relative py-0.5">
                        <span
                          aria-hidden
                          className="pointer-events-none absolute bottom-1.5 top-1.5 left-[19px] w-px bg-[#e2e8f0]"
                        />
                        <div className="flex flex-col gap-0.5">
                          {group.children.map((child) => {
                            const selected = page === child.id;
                            return (
                              <button
                                key={child.id}
                                type="button"
                                title={child.label}
                                onClick={() => goChild(group.key, child.id)}
                                className={cn(
                                  "relative ml-7 mr-1 flex h-8 cursor-pointer items-center text-left",
                                  "rounded-md pl-3.5 pr-2.5",
                                  TRANSITION,
                                  selected
                                    ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                                    : "font-normal text-[#475569] hover:bg-[#f8fafc]"
                                )}
                                style={{ fontSize: 12.5 }}
                              >
                                {selected && (
                                  <span
                                    aria-hidden
                                    className="absolute left-0 top-1/2 h-3.5 w-[2.5px] -translate-y-1/2 rounded-full bg-[var(--accent)]"
                                  />
                                )}
                                <span className="truncate leading-none">{child.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* 底部：左状态/设置，右下角收缩图标（无底色） */}
      <div
        className={cn(
          "relative mt-auto flex items-center border-t border-[#f1f5f9]",
          collapsed ? "flex-col gap-1 px-1 py-2" : "justify-between gap-1 px-2 py-2"
        )}
      >
        <StatusCluster
          busy={busy}
          collapsed={collapsed}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          menuRef={menuRef}
          onToggleCollapseFeature={onToggleCollapseFeature}
          onOpenSettings={() => {
            setMenuOpen(false);
            showStart();
          }}
        />
        <button
          type="button"
          onClick={onToggleCollapse}
          disabled={!collapseEnabled}
          title={
            collapseEnabled
              ? collapsed
                ? "展开侧栏"
                : "收缩侧栏"
              : "侧栏收缩未启用（在状态灯上连点三次开启）"
          }
          aria-label={
            collapseEnabled
              ? collapsed
                ? "展开侧栏"
                : "收缩侧栏"
              : "侧栏收缩未启用"
          }
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#94a3b8]",
            TRANSITION,
            collapseEnabled
              ? "hover:text-[var(--accent)]"
              : "cursor-not-allowed opacity-35"
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4 transition-transform duration-200" />
          ) : (
            <PanelLeftClose className="h-4 w-4 transition-transform duration-200" />
          )}
        </button>
      </div>
    </aside>
  );
}

function StatusCluster({
  busy,
  collapsed,
  menuOpen,
  setMenuOpen,
  menuRef,
  onToggleCollapseFeature,
  onOpenSettings,
}: {
  busy: boolean;
  collapsed: boolean;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggleCollapseFeature: () => void;
  onOpenSettings: () => void;
}) {
  const clickRef = useRef<{ count: number; timer: number | null }>({
    count: 0,
    timer: null,
  });

  const onStatusDotClick = useCallback(() => {
    const state = clickRef.current;
    state.count += 1;
    if (state.timer != null) window.clearTimeout(state.timer);
    if (state.count >= 3) {
      state.count = 0;
      state.timer = null;
      onToggleCollapseFeature();
      return;
    }
    state.timer = window.setTimeout(() => {
      state.count = 0;
      state.timer = null;
    }, 550);
  }, [onToggleCollapseFeature]);

  return (
    <div ref={menuRef} className="relative inline-flex items-center gap-1">
      <div
        className={cn(
          "inline-flex items-center gap-1.5",
          collapsed ? "flex-col px-0" : "px-1"
        )}
        title={busy ? "执行中" : "空闲"}
      >
        <button
          type="button"
          aria-label={busy ? "执行中" : "空闲"}
          onClick={onStatusDotClick}
          className="relative inline-flex h-2.5 w-2.5 items-center justify-center"
        >
          <span
            className={cn(
              "absolute inset-0 rounded-full opacity-40",
              busy ? "bg-amber-400 qs-status-pulse" : "bg-emerald-400 qs-status-soft"
            )}
          />
          <span
            className={cn(
              "relative h-2 w-2 rounded-full",
              busy ? "bg-amber-500" : "bg-emerald-500"
            )}
          />
        </button>
        {!collapsed && (
          <span
            className={cn(
              "text-[12.5px] font-medium",
              busy ? "text-amber-600" : "text-slate-600"
            )}
          >
            {busy ? "执行中" : "空闲"}
          </span>
        )}
        <button
          type="button"
          data-qs-doc-toggle
          aria-label="设置"
          aria-expanded={menuOpen}
          title="设置"
          onClick={() => setMenuOpen(!menuOpen)}
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-md text-[#94a3b8]",
            TRANSITION,
            "hover:text-[var(--text-primary)]",
            menuOpen && "text-[var(--text-primary)]"
          )}
        >
          <Settings
            className={cn("h-3.5 w-3.5", busy && "qs-gear-spin text-amber-500/80")}
          />
        </button>
      </div>

      {menuOpen ? (
        <div
          className={cn(
            "absolute z-50 min-w-[168px] overflow-hidden rounded-xl border border-[#e8eef5] bg-white py-1",
            "shadow-[0_12px_40px_-12px_rgba(15,23,42,0.35)]",
            collapsed
              ? "bottom-0 left-[calc(100%+8px)]"
              : "bottom-[calc(100%+8px)] left-0"
          )}
          role="menu"
        >
          <MenuItem
            icon={<Settings className="h-4 w-4 text-slate-500" />}
            label="设置"
            hint="Ctrl + ,"
            onClick={onOpenSettings}
          />
          <MenuItem
            icon={<Megaphone className="h-4 w-4 text-[#c084fc]" />}
            label="意见反馈"
            onClick={() => {
              setMenuOpen(false);
              emitToast("工作台", "意见反馈", "感谢反馈，可联系产品同学或提交工单", "info");
              void window.qsApi?.openPath?.(
                "mailto:support@example.com?subject=QS数据采集反馈"
              );
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-slate-700",
        TRANSITION,
        "hover:bg-[#f8fafc]"
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {hint ? (
        <span className="rounded bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[10px] text-[#94a3b8]">
          {hint}
        </span>
      ) : null}
    </button>
  );
}
