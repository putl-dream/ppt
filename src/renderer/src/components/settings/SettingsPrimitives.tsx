import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

export function SettingsRow({
  label,
  muted = false,
  children,
}: {
  label: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx("settings-row", muted && "is-muted")}>
      <div className="settings-row-label">{label}</div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-title">
        <h3>{title}</h3>
        {hint ? <span className="settings-hint">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className="settings-panel">{children}</div>;
}
