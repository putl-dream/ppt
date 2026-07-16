import React from "react";
import type { AgentTaskNode } from "@shared/agent-task-graph";
import type { TeamSessionProjection, TeamSessionStatus, TeamTaskActivity } from "@shared/team-session";
import { projectTeamSession } from "@shared/team-session";
import { ProcessTracePanel } from "./ProcessTracePanel";

const STATUS_COPY: Record<TeamSessionStatus, string> = {
  running: "进行中",
  completed: "已完成",
  error: "执行失败",
  cancelled: "已取消",
};

function TeamStatusMark({ status }: { status: TeamSessionStatus }) {
  if (status === "running") {
    return <span className="step-spinner team-session-status-spinner" aria-hidden="true" />;
  }
  const glyph = status === "completed" ? "✓" : status === "error" ? "!" : "×";
  return (
    <span className={`team-session-status-mark team-session-status-mark--${status}`} aria-hidden="true">
      {glyph}
    </span>
  );
}

interface TeamSessionCardProps {
  session: TeamSessionProjection;
  attention?: boolean;
  variant?: "stream" | "overview";
  onFocus: (sessionId: string) => void;
}

export const TeamSessionCard: React.FC<TeamSessionCardProps> = ({
  session,
  attention = false,
  variant = "stream",
  onFocus,
}) => (
  <button
    type="button"
    className={[
      "team-session-card",
      `team-session-card--${session.status}`,
      `team-session-card--${variant}`,
      attention ? "team-session-card--attention" : "",
    ].filter(Boolean).join(" ")}
    onClick={() => onFocus(session.id)}
    aria-label={`查看子任务：${session.title}，${STATUS_COPY[session.status]}`}
  >
    <span className="team-session-card-heading">
      <span className="team-session-card-status">
        <TeamStatusMark status={session.status} />
        <span>{STATUS_COPY[session.status]}</span>
      </span>
      <span className="team-session-card-agent">{session.agentName}</span>
    </span>
    <strong className="team-session-card-title">{session.title}</strong>
    <span className="team-session-card-activity">{session.currentActivity}</span>
    <span className="team-session-card-meta">
      <span>{session.toolCount > 0 ? `${session.toolCount} 次工具操作` : "尚未调用工具"}</span>
      {session.stepCount > 0 && <span>{session.stepCount} 条动态</span>}
      {attention && <span className="team-session-card-new">有新进展</span>}
      <span className="team-session-card-open">查看详情 →</span>
    </span>
  </button>
);

interface TeamSessionCardsProps {
  activities: TeamTaskActivity[];
  graphTasks?: AgentTaskNode[];
  attentionIds?: ReadonlySet<string>;
  onFocus: (sessionId: string) => void;
}

export const TeamSessionCards: React.FC<TeamSessionCardsProps> = ({
  activities,
  graphTasks = [],
  attentionIds,
  onFocus,
}) => {
  if (activities.length === 0) return null;
  const sessions = activities.map((activity) => projectTeamSession(activity, graphTasks));
  const ids = new Set(sessions.map((session) => session.id));
  const roots = sessions.filter((session) => !session.parentId || !ids.has(session.parentId));
  const renderBranch = (session: TeamSessionProjection): React.ReactNode => {
    const children = sessions.filter((candidate) => candidate.parentId === session.id);
    return (
      <div className="team-session-branch" key={session.id}>
        <TeamSessionCard
          session={session}
          attention={attentionIds?.has(session.id)}
          onFocus={onFocus}
        />
        {children.length > 0 && (
          <div className="team-session-children" aria-label={`${session.title} 的子任务`}>
            {children.map(renderBranch)}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="team-session-stream-group" aria-label="协作子任务">
      {roots.map(renderBranch)}
    </section>
  );
};

interface TeamOverviewProps {
  sessions: TeamSessionProjection[];
  attentionIds: ReadonlySet<string>;
  onFocus: (sessionId: string) => void;
}

export const TeamOverview: React.FC<TeamOverviewProps> = ({
  sessions,
  attentionIds,
  onFocus,
}) => {
  const running = sessions.filter((session) => session.status === "running").length;
  const completed = sessions.filter((session) => session.status === "completed").length;
  const needsAttention = sessions.filter((session) =>
    session.status === "error" || attentionIds.has(session.id)
  ).length;

  return (
    <section className="team-overview" aria-labelledby="team-overview-title">
      <div className="team-overview-heading">
        <div>
          <span className="team-overview-eyebrow">Team overview</span>
          <h2 id="team-overview-title">并行协作总览</h2>
          <p>选择一个子任务查看完整事件流；后台更新不会切换当前视图。</p>
        </div>
        <div className="team-overview-stats" aria-label="协作任务统计">
          <span><strong>{running}</strong> 进行中</span>
          <span><strong>{completed}</strong> 已完成</span>
          <span className={needsAttention > 0 ? "is-attention" : ""}>
            <strong>{needsAttention}</strong> 待关注
          </span>
        </div>
      </div>
      <div className="team-overview-board">
        {sessions.map((session) => (
          <TeamSessionCard
            key={session.id}
            session={session}
            attention={attentionIds.has(session.id)}
            variant="overview"
            onFocus={onFocus}
          />
        ))}
      </div>
    </section>
  );
};

export const FocusedTeamSession: React.FC<{ session: TeamSessionProjection }> = ({ session }) => (
  <section className="focused-team-session" aria-labelledby="focused-team-session-title">
    <header className={`focused-team-session-hero focused-team-session-hero--${session.status}`}>
      <div className="focused-team-session-status">
        <TeamStatusMark status={session.status} />
        <span>{STATUS_COPY[session.status]}</span>
      </div>
      <h2 id="focused-team-session-title">{session.title}</h2>
      <p>{session.currentActivity}</p>
      <div className="focused-team-session-meta">
        <span>执行者 · {session.agentName}</span>
        <span>{session.toolCount} 次工具操作</span>
        <span>{session.stepCount} 条事件</span>
      </div>
    </header>
    <div className="focused-team-session-stream">
      <div className="focused-team-session-stream-heading">
        <span>完整事件流</span>
        {session.status === "running" && <span className="focused-team-session-live">实时更新</span>}
      </div>
      {session.activity.steps.length > 0 ? (
        <ProcessTracePanel
          items={[session.activity]}
          live={session.status === "running"}
          defaultOpen
          defaultExpandRows
        />
      ) : (
        <div className="focused-team-session-empty">子任务正在初始化，事件到达后会在这里显示。</div>
      )}
    </div>
  </section>
);

export const LeadWaitingState: React.FC<{ runningCount: number }> = ({ runningCount }) => (
  <div className="lead-waiting-state" role="status">
    <span className="lead-waiting-state-dots" aria-hidden="true"><i /><i /><i /></span>
    <span>
      <strong>Lead 正在等待子任务汇总</strong>
      <small>{runningCount} 个协作任务仍在后台运行，完成后会更新卡片。</small>
    </span>
  </div>
);
