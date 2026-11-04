import { FolderOpen, FileSpreadsheet, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocPanel } from "@/context/DocPanelContext";
import { cn } from "@/lib/utils";

/** 采集页「上次 CSV」信息区：路径 + 打开文件 / 侧栏浏览 */
export function LastCsvBar({
  csvPath,
  onGoMedia,
  className,
}: {
  csvPath: string;
  onGoMedia?: () => void;
  className?: string;
}) {
  const { browseFolder } = useDocPanel();
  const path = String(csvPath || "").trim();
  if (!path) return null;
  const dir = path.replace(/[/\\][^/\\]+$/, "") || path;

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[#f8fafc] px-3.5 py-3",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-[var(--text-secondary)]">上次 CSV</div>
          <div className="mt-0.5 break-all font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
            {path}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-8 gap-1.5 px-3 text-xs"
          onClick={() => window.qsApi?.openPath?.(path)}
          title="打开 CSV 文件"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          打开文件
        </Button>
        <Button
          type="button"
          data-qs-doc-toggle
          variant="ghost"
          className="h-8 gap-1.5 px-3 text-xs"
          onClick={() => browseFolder(dir)}
          title="在侧栏浏览该目录下的文件"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          浏览数据
        </Button>
        {onGoMedia ? (
          <Button
            type="button"
            variant="ghost"
            className="h-8 gap-1.5 px-3 text-xs"
            onClick={onGoMedia}
          >
            去下载
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
