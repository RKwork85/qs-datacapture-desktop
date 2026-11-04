import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  Component,
  type ErrorInfo,
} from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { PageFrame } from "./PageFrame";
import { cn } from "@/lib/utils";

type Kpis = {
  todayCollect: number;
  todayCollectTrend: number;
  todayNotePub: number;
  todayVideoPub: number;
  todayPubTrend: number;
  totalLikes: number;
  likesTrend: number;
  successRate: number;
  successTrend: number;
};

type DashData = {
  kpis: Kpis;
  trend: { date: string; fullDate: string; collect: number; publish: number }[];
  statusPie: { name: string; value: number; color: string }[];
  timeline: {
    id: string;
    at: string;
    title: string;
    kind: string;
    status: string;
    detail: string;
  }[];
  rangeDays: number;
};

const EMPTY_KPIS: Kpis = {
  todayCollect: 0,
  todayCollectTrend: 0,
  todayNotePub: 0,
  todayVideoPub: 0,
  todayPubTrend: 0,
  totalLikes: 0,
  likesTrend: 0,
  successRate: 100,
  successTrend: 0,
};

class ChartErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("[dashboard chart]", err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">图表暂时无法显示</p>
        )
      );
    }
    return this.props.children;
  }
}

/** 避免 ResponsiveContainer 在 Electron 中尺寸死循环导致闪退 */
function useBoxWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function TrendHint({ value }: { value: number }) {
  if (!value) {
    return <span className="text-xs text-[var(--text-muted)]">较昨日持平</span>;
  }
  const up = value > 0;
  return (
    <span className={cn("text-xs font-medium", up ? "text-[var(--success)]" : "text-[var(--danger)]")}>
      {up ? "↑" : "↓"} {Math.abs(value)}% 较昨日
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  trend: number;
}) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-white p-5"
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <div className="text-xs font-medium text-[var(--text-muted)]">{label}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight text-[var(--text-primary)]">{value}</div>
      {sub ? <div className="mt-1 text-xs text-[var(--text-secondary)]">{sub}</div> : null}
      <div className="mt-2">
        <TrendHint value={trend} />
      </div>
    </div>
  );
}

function statusLabel(s: string) {
  if (s === "failed") return "失败";
  if (s === "scheduled") return "定时中";
  return "成功";
}

function TrendChart({ data }: { data: DashData["trend"] }) {
  const { ref, width } = useBoxWidth();
  return (
    <div ref={ref} className="h-[280px] w-full min-w-0">
      {width > 40 ? (
        <ChartErrorBoundary>
          <LineChart width={width} height={280} data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={36}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
              }}
            />
            <Line
              type="monotone"
              dataKey="collect"
              name="采集量"
              stroke="#2563eb"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="publish"
              name="发布量"
              stroke="#93c5fd"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartErrorBoundary>
      ) : null}
    </div>
  );
}

function StatusChart({ data }: { data: DashData["statusPie"] }) {
  const { ref, width } = useBoxWidth();
  const size = Math.min(Math.max(width, 160), 220);
  const pieData = data.length ? data : [{ name: "暂无", value: 1, color: "#bfdbfe" }];
  return (
    <div ref={ref} className="flex h-[160px] w-full min-w-0 items-center justify-center">
      {width > 40 ? (
        <ChartErrorBoundary>
          <PieChart width={size} height={160}>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={68}
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {pieData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ChartErrorBoundary>
      ) : null}
    </div>
  );
}

export function DashboardPage() {
  const [range, setRange] = useState<7 | 30>(7);
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chartsReady, setChartsReady] = useState(false);

  const load = useCallback(async (days: 7 | 30) => {
    setLoading(true);
    setError("");
    try {
      const res = (await window.qsApi?.getDashboardStats?.(days)) as DashData | undefined;
      if (!res?.kpis) throw new Error("无法加载看板数据");
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData({
        kpis: EMPTY_KPIS,
        trend: [],
        statusPie: [{ name: "暂无任务", value: 1, color: "#bfdbfe" }],
        timeline: [],
        rangeDays: days,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  // 等布局完成后再挂载图表，避开首屏 0 宽测量
  useEffect(() => {
    if (loading) {
      setChartsReady(false);
      return;
    }
    const t = window.setTimeout(() => setChartsReady(true), 50);
    return () => window.clearTimeout(t);
  }, [loading, data]);

  const k = data?.kpis ?? EMPTY_KPIS;

  return (
    <PageFrame
      pageId="data.dashboard"
      title="数据看板"
      hint="总览采集、发布与任务健康度。数据来自本机历史记录与已下载笔记。"
      layout="wide"
    >
      <div className="mb-1 flex w-full flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={range === 7 ? "secondary" : "ghost"}
          className="h-8 px-3"
          onClick={() => setRange(7)}
        >
          近 7 天
        </Button>
        <Button
          type="button"
          variant={range === 30 ? "secondary" : "ghost"}
          className="h-8 px-3"
          onClick={() => setRange(30)}
        >
          近 30 天
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-3"
          disabled={loading}
          onClick={() => void load(range)}
        >
          刷新
        </Button>
      </div>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="今日新增采集"
          value={loading ? "—" : `${k.todayCollect}`}
          sub="条"
          trend={k.todayCollectTrend}
        />
        <KpiCard
          label="今日发布"
          value={
            loading ? (
              "—"
            ) : (
              <span className="text-[1.65rem]">
                图文 {k.todayNotePub}
                <span className="mx-1.5 text-lg font-normal text-[var(--text-muted)]">/</span>
                视频 {k.todayVideoPub}
              </span>
            )
          }
          trend={k.todayPubTrend}
        />
        <KpiCard
          label="总点赞量"
          value={loading ? "—" : k.totalLikes.toLocaleString()}
          trend={k.likesTrend}
        />
        <KpiCard
          label="任务成功率"
          value={loading ? "—" : `${k.successRate}%`}
          trend={k.successTrend}
        />
      </div>

      <div className="grid w-full gap-4 lg:grid-cols-3">
        <section
          className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-white p-5 lg:col-span-2"
          style={{ boxShadow: "var(--shadow-soft)" }}
        >
          <header className="mb-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">采集 / 发布趋势</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">近 {range} 天对比</p>
          </header>
          {chartsReady && data ? (
            <TrendChart data={data.trend || []} />
          ) : (
            <div className="flex h-[280px] items-center justify-center text-sm text-[var(--text-muted)]">
              {loading ? "加载中…" : "准备图表…"}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div
            className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-white p-5"
            style={{ boxShadow: "var(--shadow-soft)" }}
          >
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">任务状态</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">成功 / 失败 / 定时中</p>
            {chartsReady && data ? (
              <StatusChart data={data.statusPie || []} />
            ) : (
              <div className="flex h-[160px] items-center justify-center text-sm text-[var(--text-muted)]">
                …
              </div>
            )}
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
              {(data?.statusPie || []).map((s) => (
                <li key={s.name} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.name} {s.value}
                </li>
              ))}
            </ul>
          </div>

          <div
            className="min-h-0 flex-1 rounded-[var(--radius-lg)] border border-[var(--border)] bg-white p-5"
            style={{ boxShadow: "var(--shadow-soft)" }}
          >
            <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">最近任务动态</h2>
            {!data?.timeline?.length ? (
              <p className="text-xs text-[var(--text-muted)]">暂无任务记录</p>
            ) : (
              <ol className="relative space-y-0 border-l border-[var(--border)] pl-4">
                {data.timeline.slice(0, 8).map((item) => (
                  <li key={item.id} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[var(--accent)]" />
                    <div className="text-[11px] text-[var(--text-muted)]">{item.at}</div>
                    <div className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">
                      {item.title}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      {statusLabel(item.status)}
                      {item.kind ? ` · ${item.kind}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </PageFrame>
  );
}
