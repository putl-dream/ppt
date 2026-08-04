import type { AgentExecutionStrategy } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import { LogManagementPanel } from "../LogManagementPanel";
import { Select } from "../Select";
import { SettingsPanel, SettingsRow, SettingsSection } from "./SettingsPrimitives";

export function AgentApprovalSettingsPanel({
  executionStrategy,
  setExecutionStrategy,
}: {
  executionStrategy: AgentExecutionStrategy;
  setExecutionStrategy: (value: AgentExecutionStrategy) => void;
}) {
  return (
    <SettingsPanel>
      <SettingsSection title="提交与审批（CommitGate）">
        <SettingsRow label="审批模式">
          <Select
            variant="ide"
            ariaLabel="审批模式"
            value={executionStrategy}
            onChange={(next) => setExecutionStrategy(next as AgentExecutionStrategy)}
            options={[
              { value: "REQUEST_APPROVAL", label: "手动确认每次修改" },
              { value: "AUTO", label: "自动应用低风险修改" },
            ]}
          />
        </SettingsRow>
        <p className="ide-hint">
          自动模式仅直接应用低风险提案；中高风险修改仍由 CommitGate 请求确认。
        </p>
      </SettingsSection>
    </SettingsPanel>
  );
}

export function AgentLimitsSettingsPanel({
  limits,
  setLimits,
}: {
  limits: AgentStepLimits;
  setLimits: (value: AgentStepLimits) => void;
}) {
  return (
    <SettingsPanel>
      <SettingsSection title="调用频率限制">
        <SettingsRow label="启用调用次数限制">
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={limits.enabled}
              onChange={(event) => setLimits({ ...limits, enabled: event.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
        </SettingsRow>
        <SettingsRow label="主 Agent 单次上限" muted={!limits.enabled}>
          <span className="ide-field-value">{limits.mainMaxSteps} 次</span>
          <input
            className="ide-range"
            type="range"
            min="8"
            max="80"
            step="1"
            value={limits.mainMaxSteps}
            disabled={!limits.enabled}
            onChange={(event) => setLimits({
              ...limits,
              mainMaxSteps: parseInt(event.target.value, 10),
            })}
          />
        </SettingsRow>
        <SettingsRow label="子 Agent 单次上限" muted={!limits.enabled}>
          <span className="ide-field-value">{limits.subMaxSteps} 次</span>
          <input
            className="ide-range"
            type="range"
            min="4"
            max="40"
            step="1"
            value={limits.subMaxSteps}
            disabled={!limits.enabled}
            onChange={(event) => setLimits({
              ...limits,
              subMaxSteps: parseInt(event.target.value, 10),
            })}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPanel>
  );
}

export function AgentLogsSettingsPanel({ notify }: { notify: (message: string) => void }) {
  return (
    <SettingsPanel>
      <LogManagementPanel notify={notify} />
    </SettingsPanel>
  );
}
