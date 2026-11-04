import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type DocKind = "xlsx" | "markdown" | "text" | "csv" | "image" | "video" | "unknown";
export type PanelView = "start" | "docs" | "folder";

export type DocTab = {
  id: string;
  path: string;
  title: string;
  kind: DocKind;
};

export type DocPane = "primary" | "secondary";

type DocPanelApi = {
  open: boolean;
  view: PanelView;
  tabs: DocTab[];
  activeId: string;
  activeTab: DocTab | null;
  secondaryId: string;
  secondaryTab: DocTab | null;
  split: boolean;
  activePane: DocPane;
  folderPath: string;
  openPanel: () => void;
  togglePanel: () => void;
  showStart: () => void;
  closePanel: () => void;
  openDoc: (path: string, title?: string) => void;
  browseFolder: (dirPath: string) => void;
  openFilePicker: () => Promise<void>;
  openWorkspaceFiles: () => Promise<void>;
  focusTab: (id: string) => void;
  closeTab: (id: string) => void;
  toggleSplit: () => void;
  setActivePane: (pane: DocPane) => void;
};

const Ctx = createContext<DocPanelApi | null>(null);

function basename(p: string) {
  return p.split(/[/\\]/).pop() || p;
}

export function detectDocKind(path: string): DocKind {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "csv") return "csv";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "mkv", "m4v"].includes(ext)) return "video";
  if (["txt", "log", "json", "xml", "yml", "yaml"].includes(ext)) return "text";
  return "unknown";
}

function normPath(p: string) {
  return String(p || "").trim().replace(/\\/g, "/").toLowerCase();
}

function makeTab(path: string, title?: string): DocTab {
  // 用规范化路径做稳定 id，避免 StrictMode 双调用导致 activeId 对不上、回退到 tabs[0]
  return {
    id: `doc:${normPath(path)}`,
    path,
    title: title || basename(path),
    kind: detectDocKind(path),
  };
}

const DOC_FILTERS = [
  {
    name: "文档",
    extensions: ["xlsx", "xls", "md", "markdown", "csv", "txt", "json", "log"],
  },
  { name: "All", extensions: ["*"] },
];

export function DocPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("start");
  const [tabs, setTabs] = useState<DocTab[]>([]);
  const [activeId, setActiveId] = useState("");
  const [secondaryId, setSecondaryId] = useState("");
  const [split, setSplit] = useState(false);
  const [activePane, setActivePane] = useState<DocPane>("primary");
  const [folderPath, setFolderPath] = useState("");
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  const splitRef = useRef(split);
  const paneRef = useRef(activePane);
  tabsRef.current = tabs;
  activeIdRef.current = activeId;
  splitRef.current = split;
  paneRef.current = activePane;

  const openPanel = useCallback(() => {
    setOpen(true);
    setView((v) => (tabs.length && v === "docs" ? "docs" : v === "folder" ? "folder" : "start"));
  }, [tabs.length]);

  const showStart = useCallback(() => {
    setView("start");
    setOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
  }, []);

  const togglePanel = useCallback(() => {
    setOpen((prev) => {
      if (prev) return false;
      setView((v) =>
        v === "docs" && tabs.length ? "docs" : v === "folder" && folderPath ? "folder" : "start"
      );
      return true;
    });
  }, [tabs.length, folderPath]);

  const assignToPane = useCallback((tabId: string, pane: DocPane) => {
    if (pane === "secondary") setSecondaryId(tabId);
    else setActiveId(tabId);
    setActivePane(pane);
  }, []);

  const openDoc = useCallback(
    (path: string, title?: string) => {
      const p = String(path || "").trim();
      if (!p) return;
      const tab = makeTab(p, title);
      setTabs((prev) => {
        const hit = prev.find((t) => normPath(t.path) === normPath(p) || t.id === tab.id);
        if (hit) return prev;
        return [...prev, tab];
      });
      setView("docs");
      setOpen(true);
      const pane = splitRef.current ? paneRef.current : "primary";
      assignToPane(tab.id, pane);
    },
    [assignToPane]
  );

  const browseFolder = useCallback((dirPath: string) => {
    const p = String(dirPath || "").trim();
    if (!p) return;
    setFolderPath(p);
    setView("folder");
    setOpen(true);
  }, []);

  const openFilePicker = useCallback(async () => {
    const roots = await window.qsApi?.getDataRoots?.().catch(() => null);
    const defaultPath = roots?.root || "";
    const p = await window.qsApi?.selectFile?.({
      filters: DOC_FILTERS,
      defaultPath,
    });
    if (p) openDoc(p);
  }, [openDoc]);

  /** 工作区文件：在开始页内打开目录树 */
  const openWorkspaceFiles = useCallback(async () => {
    setView("start");
    setOpen(true);
    window.dispatchEvent(new CustomEvent("qs:show-workspace-tree"));
  }, []);

  const focusTab = useCallback(
    (id: string) => {
      setView("docs");
      setOpen(true);
      assignToPane(id, splitRef.current ? paneRef.current : "primary");
    },
    [assignToPane]
  );

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        return next[0]?.id || "";
      });
      setSecondaryId((cur) => {
        if (cur !== id) return cur;
        const leftover = next.find((t) => t.id !== id);
        return leftover?.id || "";
      });
      if (!next.length) {
        setSplit(false);
        setView("start");
      }
      return next;
    });
  }, []);

  const toggleSplit = useCallback(() => {
    if (splitRef.current) {
      setSplit(false);
      setActivePane("primary");
      return;
    }
    const curr = tabsRef.current;
    const primary = activeIdRef.current || curr[0]?.id || "";
    const secondary = curr.find((t) => t.id !== primary)?.id || primary;
    if (primary) setActiveId(primary);
    setSecondaryId(secondary);
    setSplit(true);
    setView("docs");
    setOpen(true);
  }, []);

  // Ctrl+Alt+B 打开/收起；Ctrl+\ 分栏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        togglePanel();
      }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "\\" || e.code === "Backslash")) {
        if (!open) return;
        e.preventDefault();
        toggleSplit();
      }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "p" || e.key === "P")) {
        if (!open) return;
        e.preventDefault();
        void openWorkspaceFiles();
      }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "t" || e.key === "T")) {
        if (!open) return;
        e.preventDefault();
        showStart();
        window.dispatchEvent(new CustomEvent("qs:focus-browser"));
      }
      // Ctrl+, 打开设置（工作台）
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        showStart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel, open, openWorkspaceFiles, showStart, toggleSplit]);

  const activeTab = useMemo(() => {
    if (!tabs.length) return null;
    const hit = tabs.find((t) => t.id === activeId);
    if (hit) return hit;
    if (!activeId) return tabs[0];
    return tabs.find((t) => normPath(t.path) === normPath(activeId.replace(/^doc:/, ""))) || null;
  }, [tabs, activeId]);

  const secondaryTab = useMemo(() => {
    if (!split || !tabs.length) return null;
    const hit = tabs.find((t) => t.id === secondaryId);
    if (hit) return hit;
    return tabs.find((t) => t.id !== activeTab?.id) || null;
  }, [split, tabs, secondaryId, activeTab?.id]);

  const value = useMemo(
    () => ({
      open,
      view,
      tabs,
      activeId: activeTab?.id || "",
      activeTab,
      secondaryId: secondaryTab?.id || "",
      secondaryTab,
      split,
      activePane,
      folderPath,
      openPanel,
      togglePanel,
      showStart,
      closePanel,
      openDoc,
      browseFolder,
      openFilePicker,
      openWorkspaceFiles,
      focusTab,
      closeTab,
      toggleSplit,
      setActivePane,
    }),
    [
      open,
      view,
      tabs,
      activeTab,
      secondaryTab,
      split,
      activePane,
      folderPath,
      openPanel,
      togglePanel,
      showStart,
      closePanel,
      openDoc,
      browseFolder,
      openFilePicker,
      openWorkspaceFiles,
      focusTab,
      closeTab,
      toggleSplit,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDocPanel() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDocPanel must be used within DocPanelProvider");
  return ctx;
}
