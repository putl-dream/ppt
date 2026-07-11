import React from "react";
import type { TokenUsageStats } from "@shared/token-usage";
import { RefreshIcon } from "./Icons";

type UsageView = "daily" | "weekly" | "cumulative";

interface CalendarCell {
  date: string;
  value: number;
  actualTokens: number;
  future: boolean;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.floor(durationMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分钟`;
  return durationMs > 0 ? "不足 1 分钟" : "0 分钟";
}

function buildCalendarCells(stats: TokenUsageStats, view: UsageView): CalendarCell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - 52 * 7);
  const totals = new Map(stats.days.map((day) => [day.date, day.totalTokens]));
  const daily = Array.from({ length: 53 * 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    return {
      date: key,
      actualTokens: totals.get(key) ?? 0,
      future: date > today,
    };
  });

  if (view === "daily") {
    return daily.map((cell) => ({ ...cell, value: cell.actualTokens }));
  }

  if (view === "weekly") {
    const weeklyTotals = new Map<number, number>();
    daily.forEach((cell, index) => {
      const week = Math.floor(index / 7);
      weeklyTotals.set(week, (weeklyTotals.get(week) ?? 0) + cell.actualTokens);
    });
    return daily.map((cell, index) => ({
      ...cell,
      value: weeklyTotals.get(Math.floor(index / 7)) ?? 0,
    }));
  }

  let cumulative = 0;
  return daily.map((cell) => {
    cumulative += cell.actualTokens;
    return { ...cell, value: cumulative };
  });
}

function intensity(value: number, max: number, future: boolean): number {
  if (future || value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

function monthMarkers(cells: CalendarCell[]): Array<{ column: number; label: string }> {
  const markers: Array<{ column: number; label: string }> = [];
  let previousMonth = "";
  for (let column = 0; column < 53; column += 1) {
    const cell = cells[column * 7];
    const month = cell.date.slice(0, 7);
    if (month !== previousMonth) {
      markers.push({ column: column + 1, label: `${Number(cell.date.slice(5, 7))}月` });
      previousMonth = month;
    }
  }
  return markers;
}

const emptyStats: TokenUsageStats = {
  totalTokens: 0,
  peakTokens: 0,
  longestTaskDurationMs: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
  days: [],
};

export const TokenUsageOverview: React.FC = () => {
  const [stats, setStats] = React.useState<TokenUsageStats>(emptyStats);
  const [view, setView] = React.useState<UsageView>("daily");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadStats = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await window.desktopApi.getTokenUsageStats());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const cells = React.useMemo(() => buildCalendarCells(stats, view), [stats, view]);
  const maxValue = Math.max(0, ...cells.filter((cell) => !cell.future).map((cell) => cell.value));
  const markers = monthMarkers(cells);
  const metrics = [
    { value: formatTokens(stats.totalTokens), label: "累计 Token 数" },
    { value: formatTokens(stats.peakTokens), label: "单日峰值 Token 数" },
    { value: formatDuration(stats.longestTaskDurationMs), label: "最长任务时长" },
    { value: `${stats.currentStreakDays} 天`, label: "当前连续天数" },
    { value: `${stats.longestStreakDays} 天`, label: "最长连续天数" },
  ];

  return (
    <div className="token-usage-shell">
      <section className="token-usage-metrics" aria-label="Token 使用概览">
        {metrics.map((metric) => (
          <div className="token-usage-metric" key={metric.label}>
            <strong>{loading ? "—" : metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </section>

      <section className="token-activity-card">
        <div className="token-activity-header">
          <div>
            <h3>Token 活动</h3>
            <p>统计由模型服务响应的真实 Token 用量累加</p>
          </div>
          <div className="token-activity-actions">
            <div className="token-view-tabs" role="tablist" aria-label="Token 活动粒度">
              {(["daily", "weekly", "cumulative"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={view === item}
                  className={view === item ? "active" : ""}
                  onClick={() => setView(item)}
                >
                  {{ daily: "每日", weekly: "每周", cumulative: "累计" }[item]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="token-usage-refresh"
              onClick={() => void loadStats()}
              aria-label="刷新 Token 统计"
              title="刷新"
              disabled={loading}
            >
              <RefreshIcon size={14} />
            </button>
          </div>
        </div>

        {error ? (
          <div className="token-usage-state is-error">
            <span>统计读取失败：{error}</span>
            <button type="button" onClick={() => void loadStats()}>重试</button>
          </div>
        ) : (
          <div className={`token-heatmap-scroll ${loading ? "is-loading" : ""}`}>
            <div className="token-heatmap-months" aria-hidden="true">
              {markers.map((marker) => (
                <span key={`${marker.column}-${marker.label}`} style={{ gridColumn: marker.column }}>
                  {marker.label}
                </span>
              ))}
            </div>
            <div className="token-heatmap-grid" aria-label="最近 53 周 Token 活动">
              {cells.map((cell) => (
                <span
                  key={cell.date}
                  className={`token-heatmap-cell level-${intensity(cell.value, maxValue, cell.future)} ${cell.future ? "is-future" : ""}`}
                  title={`${cell.date} · ${cell.actualTokens.toLocaleString("zh-CN")} Tokens`}
                />
              ))}
            </div>
          </div>
        )}

        {!loading && !error && stats.totalTokens === 0 && (
          <p className="token-usage-empty">完成下一次模型调用后，这里会开始记录真实 Token 消耗。</p>
        )}
      </section>
    </div>
  );
};
