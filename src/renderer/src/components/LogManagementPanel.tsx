import React from "react";
import type { AppLogEntry, AppLogLevel, LogManagerStatus } from "@shared/logging";
import { FolderIcon, RefreshIcon, TrashIcon } from "./Icons";

interface LogManagementPanelProps {
  notify: (message: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatEntryDetail(entry: AppLogEntry): string | undefined {
  for (const detail of [entry.error, entry.reason]) {
    if (detail && typeof detail === "object" && "message" in detail) {
      return String((detail as { message?: unknown }).message ?? "");
    }
  }
  if (typeof entry.message === "string") return entry.message;
  if (typeof entry.reason === "string") return entry.reason;
  if (Array.isArray(entry.arguments)) {
    return entry.arguments.map((argument) => {
      if (typeof argument === "string") return argument;
      if (argument && typeof argument === "object" && "message" in argument) {
        return String((argument as { message?: unknown }).message ?? "");
      }
      return "";
    }).filter(Boolean).join(" · ") || undefined;
  }
  return undefined;
}

export const LogManagementPanel: React.FC<LogManagementPanelProps> = ({ notify }) => {
  const [status, setStatus] = React.useState<LogManagerStatus | null>(null);
  const [entries, setEntries] = React.useState<AppLogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextEntries] = await Promise.all([
        window.desktopApi.getLogManagerStatus(),
        window.desktopApi.getRecentLogs(50, "warn"),
      ]);
      setStatus(nextStatus);
      setEntries(nextEntries);
    } catch (error) {
      notify(`读取日志状态失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateSettings = async (patch: { level?: AppLogLevel; fileEnabled?: boolean }) => {
    try {
      await window.desktopApi.updateLogManagerSettings(patch);
      await refresh();
      notify("日志设置已保存");
    } catch (error) {
      notify(`保存日志设置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const openDirectory = async () => {
    if (!(await window.desktopApi.openLogDirectory())) notify("无法打开日志目录");
  };

  const clearLogs = async () => {
    if (!window.confirm("确定清理全部日志文件吗？此操作不会影响项目和会话数据。")) return;
    try {
      const count = await window.desktopApi.clearLogs();
      await refresh();
      notify(`已清理 ${count} 个日志文件`);
    } catch (error) {
      notify(`清理日志失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="settings-panel-fade">
      <section className="settings-card log-management-summary">
        <div className="settings-card-header">
          <div className="settings-card-title-block"><h3>日志采集</h3></div>
          <div className="settings-card-meta">{status?.fileEnabled ? "运行中" : "仅控制台"}</div>
        </div>

        <div className="log-status-grid">
          <div><span>文件</span><strong>{status?.fileCount ?? "—"}</strong></div>
          <div><span>占用空间</span><strong>{status ? formatBytes(status.totalBytes) : "—"}</strong></div>
          <div><span>保留周期</span><strong>{status ? `${status.retentionDays} 天` : "—"}</strong></div>
          <div><span>单文件上限</span><strong>{status ? `${status.maxFileSizeMb} MB` : "—"}</strong></div>
        </div>

        <div className="settings-form-stack">
          <label className="setting-row">
            <span className="setting-row-copy"><span className="setting-row-title">最低记录级别</span></span>
            <span className="setting-row-control">
              <select
                className="model-select log-level-select"
                value={status?.level ?? "info"}
                disabled={!status}
                onChange={(event) => void updateSettings({ level: event.target.value as AppLogLevel })}
              >
                <option value="debug">Debug（完整诊断）</option>
                <option value="info">Info（推荐）</option>
                <option value="warn">Warn（仅问题）</option>
                <option value="error">Error（仅错误）</option>
              </select>
            </span>
          </label>
          <label className="setting-row">
            <span className="setting-row-copy"><span className="setting-row-title">写入日志文件</span></span>
            <span className="setting-row-control">
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={status?.fileEnabled ?? false}
                  disabled={!status}
                  onChange={(event) => void updateSettings({ fileEnabled: event.target.checked })}
                />
                <span className="toggle-slider" />
              </span>
            </span>
          </label>
        </div>

        <div className="log-management-actions">
          <button className="settings-secondary-btn" onClick={() => void refresh()} disabled={loading}>
            <RefreshIcon size={14} /> {loading ? "刷新中" : "刷新"}
          </button>
          <button className="settings-secondary-btn" onClick={() => void openDirectory()}>
            <FolderIcon size={14} /> 打开目录
          </button>
          <button className="settings-secondary-btn log-clear-btn" onClick={() => void clearLogs()}>
            <TrashIcon size={14} /> 清理日志
          </button>
        </div>
        {status && <div className="settings-path-display"><FolderIcon size={14} /><span>{status.directory}</span></div>}
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div className="settings-card-title-block"><h3>最近问题</h3></div>
          <div className="settings-card-meta">Warn / Error · {entries.length}</div>
        </div>
        <div className="log-entry-list">
          {entries.length === 0 ? (
            <div className="log-empty-state">最近日志中没有捕获到警告或错误</div>
          ) : entries.map((entry, index) => (
            <div className={`log-entry log-entry--${entry.level}`} key={`${entry.timestamp}-${entry.event}-${index}`}>
              <div className="log-entry-topline">
                <span className="log-entry-level">{entry.level}</span>
                <code>{entry.module ? `${entry.module} · ` : ""}{entry.event}</code>
                <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
              </div>
              {formatEntryDetail(entry) && <p>{formatEntryDetail(entry)}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
