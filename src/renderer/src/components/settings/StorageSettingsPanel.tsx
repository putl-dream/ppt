import React from "react";
import { normalizeWorkspacePath } from "@shared/workspace";
import { FolderIcon } from "../Icons";
import { SettingsPanel, SettingsRow, SettingsSection } from "./SettingsPrimitives";

export function StorageSettingsPanel({
  localStoragePath,
  onOpenWorkspace,
  notify,
}: {
  localStoragePath: string;
  onOpenWorkspace: () => void;
  notify: (message: string) => void;
}) {
  const [applicationDataPath, setApplicationDataPath] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void window.desktopApi.getApplicationDataPath()
      .then((path) => {
        if (!cancelled) setApplicationDataPath(normalizeWorkspacePath(path));
      })
      .catch(() => {
        if (!cancelled) setApplicationDataPath("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenWorkspace = () => {
    try {
      onOpenWorkspace();
    } catch (error) {
      notify(`打开目录失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleOpenApplicationData = async () => {
    try {
      if (!(await window.desktopApi.openApplicationDataDirectory())) {
        notify("无法打开应用数据目录");
      }
    } catch (error) {
      notify(`打开应用数据目录失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <SettingsPanel>
      <SettingsSection title="存储与目录">
        <SettingsRow label="项目目录">
          <div className="ide-path">
            <FolderIcon size={14} />
            <span className="ide-path-text" title={localStoragePath}>
              {localStoragePath || "尚未打开项目目录"}
            </span>
            <button
              type="button"
              className="ide-btn-secondary"
              onClick={() => void handleOpenWorkspace()}
            >
              打开目录
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label="应用数据">
          <div className="ide-path">
            <FolderIcon size={14} />
            <span className="ide-path-text" title={applicationDataPath}>
              {applicationDataPath || "读取中…"}
            </span>
            <button
              type="button"
              className="ide-btn-secondary"
              disabled={!applicationDataPath}
              onClick={() => void handleOpenApplicationData()}
            >
              打开目录
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label="说明">
          <span className="ide-hint">
            应用数据目录存放会话、日志与用量统计；可用环境变量 AGENT_PPT_DATA_DIR 覆盖。
          </span>
        </SettingsRow>
      </SettingsSection>
    </SettingsPanel>
  );
}
