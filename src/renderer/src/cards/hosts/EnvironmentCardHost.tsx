import React from "react";
import { FolderIcon } from "../../components/Icons";

interface EnvironmentCardHostProps {
  ready: boolean;
  onPrepare?: () => void;
}

/** Frontend/system-owned environment guidance; never depends on an Agent tool call. */
export const EnvironmentCardHost: React.FC<EnvironmentCardHostProps> = ({
  ready,
  onPrepare,
}) => {
  if (ready) return null;
  return (
    <section className="sandbox-preflight-card" aria-labelledby="sandbox-preflight-title">
      <div className="sandbox-preflight-icon"><FolderIcon size={18} /></div>
      <div className="sandbox-preflight-copy">
        <strong id="sandbox-preflight-title">项目目录（可选）</strong>
        <span>可直接发送，系统会自动创建托管沙箱；也可以先选择保存目录。</span>
      </div>
      <button type="button" className="sandbox-preflight-btn" onClick={onPrepare}>
        选择项目目录
      </button>
    </section>
  );
};
