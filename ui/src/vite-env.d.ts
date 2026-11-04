/// <reference types="vite/client" />

declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.svg" {
  const src: string;
  export default src;
}
declare module "*.ico" {
  const src: string;
  export default src;
}

export {};

declare global {
  interface Window {
    qsApi?: {
      getConfig: () => Promise<{ version?: string }>;
      getXhsAuthStatus?: () => Promise<{
        hasCookie?: boolean;
        ready?: boolean;
        missing?: string[];
        cookiePath?: string;
        mtime?: number;
        error?: string;
      }>;
      getDyAuthStatus?: () => Promise<{
        hasCookie?: boolean;
        ready?: boolean;
        missing?: string[];
        cookiePath?: string;
        mtime?: number;
        error?: string;
      }>;
      getWeiboAuthStatus?: () => Promise<{
        hasAuth?: boolean;
        ready?: boolean;
        authPath?: string;
        mtime?: number;
        error?: string;
      }>;
      clearAuth?: (
        platform: "dy" | "xhs" | "weibo"
      ) => Promise<{ ok?: boolean; removed?: string[]; error?: string }>;
      listWeiboRecords?: () => Promise<{
        hot?: unknown[];
        detail?: unknown[];
        comment?: unknown[];
        xlsx?: unknown[];
      }>;
      listDyRecords?: () => Promise<{
        batches?: unknown[];
        publishNotes?: unknown[];
        publishVideos?: unknown[];
      }>;
      getDataRoots?: () => Promise<{ root?: string; xhs?: string; weibo?: string; dy?: string }>;
      listDirFiles?: (
        dirPath: string
      ) => Promise<{
        ok?: boolean;
        dir?: string;
        files?: { name: string; path: string; mtime: number; size?: number }[];
        error?: string;
      }>;
      listDirEntries?: (
        dirPath: string
      ) => Promise<{
        ok?: boolean;
        dir?: string;
        entries?: {
          name: string;
          path: string;
          isDir: boolean;
          mtime: number;
          size?: number;
        }[];
        error?: string;
      }>;
      browseOpen?: (payload: {
        platform?: "xhs" | "weibo" | "dy";
        url?: string;
      }) => Promise<{ ok?: boolean; error?: string; url?: string; platform?: string }>;
      windowMinimize: () => Promise<void>;
      windowMaximize: () => Promise<void>;
      windowClose: () => Promise<void>;
      windowIsMaximized: () => Promise<boolean>;
      setWindowBackground?: (color: string) => Promise<{ ok?: boolean; color?: string }>;
      onWindowMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
      onPaintBackground?: (cb: (color: string) => void) => () => void;
      usesNativeTitleOverlay?: () => boolean;
      onLog: (cb: (payload: { level?: string; message: string }) => void) => () => void;
      runTask: (
        type: string,
        params?: Record<string, unknown>
      ) => Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }>;
      selectDir: () => Promise<string | undefined>;
      selectFile: (
        filtersOrOpts?:
          | { name: string; extensions: string[] }[]
          | {
              filters?: { name: string; extensions: string[] }[];
              defaultPath?: string;
            }
      ) => Promise<string | undefined>;
      openPath: (p: string) => Promise<string>;
      readTextFile?: (
        filePath: string
      ) => Promise<{ ok?: boolean; content?: string; path?: string; error?: string }>;
      readMediaDataUrl?: (
        filePath: string
      ) => Promise<{
        ok?: boolean;
        path?: string;
        mime?: string;
        dataUrl?: string;
        size?: number;
        error?: string;
      }>;
      toFileUrl?: (
        filePath: string
      ) => Promise<{ ok?: boolean; path?: string; url?: string; error?: string }>;
      listXhsRecords?: () => Promise<{
        history?: unknown[];
        collects?: unknown[];
        batches?: unknown[];
        publishNotes?: unknown[];
        publishVideos?: unknown[];
      }>;
      listNotesInBatch?: (outRoot: string) => Promise<unknown[]>;
      previewBatchNotes?: (
        outRoot: string
      ) => Promise<{ ok?: boolean; rows?: unknown[]; error?: string }>;
      previewXlsx?: (
        filePath: string
      ) => Promise<{
        ok?: boolean;
        headers?: string[];
        rows?: Record<string, string>[];
        filePath?: string;
        error?: string;
      }>;
      previewCsv?: (
        filePath: string
      ) => Promise<{
        ok?: boolean;
        headers?: string[];
        rows?: Record<string, string>[];
        filePath?: string;
        error?: string;
      }>;
      getDashboardStats?: (rangeDays?: number) => Promise<Record<string, unknown>>;
      readNoteMeta?: (folder: string) => Promise<Record<string, unknown> | null>;
      controlLogin?: (payload: unknown) => Promise<unknown>;
      controlEnsureSession?: () => Promise<{
        ok?: boolean;
        username?: string;
        reused?: boolean;
        error?: string;
      }>;
      controlPoll?: () => Promise<unknown>;
      controlRunPending?: () => Promise<{ ok?: boolean; ran?: number; error?: string }>;
      controlCreateTask?: (payload: {
        type: string;
        params?: Record<string, unknown>;
        priority?: number;
      }) => Promise<{ ok?: boolean; task?: Record<string, unknown>; error?: string }>;
      controlListTasks?: (query?: {
        status?: string;
      }) => Promise<{ ok?: boolean; tasks?: Record<string, unknown>[]; error?: string }>;
      controlConnectWs?: () => Promise<unknown>;
      controlListSchedules?: (query?: {
        platform?: string;
      }) => Promise<{ ok?: boolean; schedules?: Record<string, unknown>[]; error?: string }>;
      controlCreateSchedule?: (payload: Record<string, unknown>) => Promise<{
        ok?: boolean;
        schedule?: Record<string, unknown>;
        error?: string;
      }>;
      controlUpdateSchedule?: (payload: Record<string, unknown>) => Promise<{
        ok?: boolean;
        schedule?: Record<string, unknown>;
        error?: string;
      }>;
      controlDeleteSchedule?: (id: string) => Promise<{ ok?: boolean; error?: string }>;
      controlRunSchedule?: (id: string) => Promise<{
        ok?: boolean;
        task?: Record<string, unknown>;
        schedule?: Record<string, unknown>;
        error?: string;
        runError?: string;
      }>;
      onControlEvent?: (cb: (payload: unknown) => void) => () => void;
    };
  }
}
