import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "qs.weibo.flow";

type Persisted = {
  lastHotCsv?: string;
  lastDetailCsv?: string;
  lastCommentCsv?: string;
  lastOut?: string;
};

type Value = {
  lastHotCsv: string;
  setLastHotCsv: (p: string) => void;
  lastDetailCsv: string;
  setLastDetailCsv: (p: string) => void;
  lastCommentCsv: string;
  setLastCommentCsv: (p: string) => void;
  lastOut: string;
  setLastOut: (p: string) => void;
};

const Ctx = createContext<Value | null>(null);

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function save(patch: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...load(), ...patch }));
  } catch {
    /* ignore */
  }
}

export function WeiboFlowProvider({ children }: { children: ReactNode }) {
  const initial = load();
  const [lastHotCsv, setHot] = useState(initial.lastHotCsv || "");
  const [lastDetailCsv, setDetail] = useState(initial.lastDetailCsv || "");
  const [lastCommentCsv, setComment] = useState(initial.lastCommentCsv || "");
  const [lastOut, setOut] = useState(initial.lastOut || "");

  const setLastHotCsv = useCallback((p: string) => {
    setHot(p);
    save({ lastHotCsv: p });
  }, []);
  const setLastDetailCsv = useCallback((p: string) => {
    setDetail(p);
    save({ lastDetailCsv: p });
  }, []);
  const setLastCommentCsv = useCallback((p: string) => {
    setComment(p);
    save({ lastCommentCsv: p });
  }, []);
  const setLastOut = useCallback((p: string) => {
    setOut(p);
    save({ lastOut: p });
  }, []);

  const value = useMemo(
    () => ({
      lastHotCsv,
      setLastHotCsv,
      lastDetailCsv,
      setLastDetailCsv,
      lastCommentCsv,
      setLastCommentCsv,
      lastOut,
      setLastOut,
    }),
    [
      lastHotCsv,
      lastDetailCsv,
      lastCommentCsv,
      lastOut,
      setLastHotCsv,
      setLastDetailCsv,
      setLastCommentCsv,
      setLastOut,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWeiboFlow() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWeiboFlow must be used within WeiboFlowProvider");
  return ctx;
}
