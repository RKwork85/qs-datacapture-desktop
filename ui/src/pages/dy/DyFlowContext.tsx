import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "qs.dy.flow";

export type NotePublishDraft = {
  imageDir: string;
  title: string;
  content: string;
  tags: string;
  schedule: boolean;
  scheduleTime: string;
  /** 自主声明文案，空=不选 */
  declaration: string;
};

export type VideoPublishDraft = {
  videoPath: string;
  title: string;
  content: string;
  tags: string;
  schedule: boolean;
  scheduleTime: string;
  declaration: string;
};

type Persisted = {
  lastCsvPath?: string;
  lastOut?: string;
  lastProfileUrl?: string;
  noteDraft?: Partial<NotePublishDraft>;
  videoDraft?: Partial<VideoPublishDraft>;
};

type DyFlowValue = {
  lastCsvPath: string;
  setLastCsvPath: (p: string) => void;
  lastOut: string;
  setLastOut: (p: string) => void;
  lastProfileUrl: string;
  setLastProfileUrl: (p: string) => void;
  noteDraft: NotePublishDraft;
  setNoteDraft: (patch: Partial<NotePublishDraft>) => void;
  videoDraft: VideoPublishDraft;
  setVideoDraft: (patch: Partial<VideoPublishDraft>) => void;
  /** 从数据记录载入到发布页 */
  applyNoteForPublish: (payload: {
    folder: string;
    title?: string;
    desc?: string;
    topics?: string;
    videoPath?: string;
    type?: string;
  }) => "note" | "video";
};

const emptyNoteDraft = (): NotePublishDraft => ({
  imageDir: "",
  title: "",
  content: "",
  tags: "",
  schedule: false,
  scheduleTime: "",
  declaration: "",
});

const emptyVideoDraft = (): VideoPublishDraft => ({
  videoPath: "",
  title: "",
  content: "",
  tags: "",
  schedule: false,
  scheduleTime: "",
  declaration: "",
});

function sanitizeTags(raw: string) {
  return String(raw || "")
    .split(/[\s,，]+/)
    .map((t) =>
      t
        .replace(/\[话题\]/g, "")
        .replace(/^#+/, "")
        .replace(/#+$/, "")
        .replace(/[\[\]【】]/g, "")
        .trim()
    )
    .filter(Boolean)
    .map((n) => `#${n}`)
    .join(" ");
}

/** 从文案里拆出话题，正文去掉话题碎片 */
function splitDescAndTopics(desc: string, topics: string) {
  let tags = sanitizeTags(topics);
  if (!tags) {
    const found = [
      ...String(desc || "").matchAll(/#([^#\s\[\]]+)(?:\[话题\])?#?/g),
    ].map((m) => m[1]);
    tags = sanitizeTags(found.join(" "));
  }
  const content = String(desc || "")
    .replace(/#[^#\s]+(?:\[话题\])?#?/g, "")
    .replace(/\[话题\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { content, tags };
}

const DyFlowContext = createContext<DyFlowValue | null>(null);

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
    const next = { ...load(), ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function DyFlowProvider({ children }: { children: ReactNode }) {
  const initial = load();
  const [lastCsvPath, setCsv] = useState(initial.lastCsvPath || "");
  const [lastOut, setOut] = useState(initial.lastOut || "");
  const [lastProfileUrl, setProfile] = useState(initial.lastProfileUrl || "");
  const [noteDraft, setNoteDraftState] = useState<NotePublishDraft>({
    ...emptyNoteDraft(),
    ...(initial.noteDraft || {}),
  });
  const [videoDraft, setVideoDraftState] = useState<VideoPublishDraft>({
    ...emptyVideoDraft(),
    ...(initial.videoDraft || {}),
  });

  const setLastCsvPath = useCallback((p: string) => {
    setCsv(p);
    save({ lastCsvPath: p });
  }, []);

  const setLastOut = useCallback((p: string) => {
    setOut(p);
    save({ lastOut: p });
  }, []);

  const setLastProfileUrl = useCallback((p: string) => {
    setProfile(p);
    save({ lastProfileUrl: p });
  }, []);

  const setNoteDraft = useCallback((patch: Partial<NotePublishDraft>) => {
    setNoteDraftState((prev) => {
      const next = { ...prev, ...patch };
      save({ noteDraft: next });
      return next;
    });
  }, []);

  const setVideoDraft = useCallback((patch: Partial<VideoPublishDraft>) => {
    setVideoDraftState((prev) => {
      const next = { ...prev, ...patch };
      save({ videoDraft: next });
      return next;
    });
  }, []);

  const applyNoteForPublish = useCallback(
    (payload: {
      folder: string;
      title?: string;
      desc?: string;
      topics?: string;
      videoPath?: string;
      type?: string;
    }) => {
      const typeText = String(payload.type || "").toLowerCase();
      const isVideo =
        Boolean(payload.videoPath) ||
        typeText.includes("video") ||
        typeText.includes("视频");
      const { content, tags } = splitDescAndTopics(
        payload.desc || "",
        payload.topics || ""
      );
      const shared = {
        title: (payload.title || "").slice(0, 20),
        content,
        tags,
      };
      if (isVideo && payload.videoPath) {
        setVideoDraft({
          ...shared,
          videoPath: payload.videoPath,
        });
        return "video";
      }
      setNoteDraft({
        ...shared,
        imageDir: payload.folder,
      });
      return "note";
    },
    [setNoteDraft, setVideoDraft]
  );

  const value = useMemo(
    () => ({
      lastCsvPath,
      setLastCsvPath,
      lastOut,
      setLastOut,
      lastProfileUrl,
      setLastProfileUrl,
      noteDraft,
      setNoteDraft,
      videoDraft,
      setVideoDraft,
      applyNoteForPublish,
    }),
    [
      lastCsvPath,
      lastOut,
      lastProfileUrl,
      noteDraft,
      videoDraft,
      setLastCsvPath,
      setLastOut,
      setLastProfileUrl,
      setNoteDraft,
      setVideoDraft,
      applyNoteForPublish,
    ]
  );

  return <DyFlowContext.Provider value={value}>{children}</DyFlowContext.Provider>;
}

export function useDyFlow() {
  const ctx = useContext(DyFlowContext);
  if (!ctx) throw new Error("useDyFlow must be used within DyFlowProvider");
  return ctx;
}

