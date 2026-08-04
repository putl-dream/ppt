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
    <div className={cx("ide-row", muted && "is-muted")}>
      <div className="ide-row-label">{label}</div>
      <div className="ide-row-control">{children}</div>
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
    <section className="ide-section">
      <div className="ide-section-title">
        <h3>{title}</h3>
        {hint ? <span className="ide-hint">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className="ide-panel">{children}</div>;
}
