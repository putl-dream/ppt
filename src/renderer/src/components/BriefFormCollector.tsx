import React, { useState, useEffect } from "react";
import { parseBriefFields, serializeBriefMarkdown } from "@shared/project-artifacts";
import { useProjectStore } from "./project-store";

export const BriefFormCollector: React.FC = () => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const updateArtifactContent = useProjectStore((state) => state.updateArtifactContent);
  const markStageReady = useProjectStore((state) => state.markStageReady);

  if (!activeProject) return null;

  const briefArtifact = activeProject.artifacts.brief;
  
  const parseBriefMarkdown = (md: string) => parseBriefFields(md, activeProject.name || "新演示文稿");

  const [fields, setFields] = useState(() => parseBriefMarkdown(briefArtifact.content));

  useEffect(() => {
    // Keep internal form state in sync if content changes from outside (e.g. Agent updates brief)
    setFields(parseBriefMarkdown(briefArtifact.content));
  }, [briefArtifact.content]);

  const updateField = (key: keyof typeof fields, value: string) => {
    const newFields = { ...fields, [key]: value };
    setFields(newFields);

    const markdown = serializeBriefMarkdown(newFields);
    
    updateArtifactContent("brief", markdown);
  };

  const handleConfirmReady = () => {
    markStageReady("brief");
  };

  return (
    <div className="brief-form-collector" style={{
      display: "flex",
      flexDirection: "row",
      height: "100%",
      background: "var(--bg-canvas)",
      borderRadius: "16px",
      overflow: "hidden",
      border: "1px solid var(--border-glass)"
    }}>
      {/* 左侧：解构式填空表单 */}
      <div className="brief-form-left" style={{
        flex: 1,
        padding: "32px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        borderRight: "1px solid var(--border-glass)"
      }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "24px" }}>
            📝 首屏 Brief 属性采集
          </h2>
          
          <div className="mad-libs-text" style={{
            fontSize: "16px",
            lineHeight: "2.2",
            color: "var(--text-secondary)",
            background: "rgba(255, 255, 255, 0.02)",
            padding: "24px",
            borderRadius: "12px",
            border: "1px solid var(--border-glass)"
          }}>
            我们正在策划一份主题为
            <input
              type="text"
              value={fields.title}
              onChange={(e) => updateField("title", e.target.value)}
              style={{
                background: "var(--bg-darker)",
                border: "none",
                borderBottom: "2px solid var(--accent-cyan)",
                color: "var(--text-primary)",
                fontSize: "16px",
                fontWeight: 600,
                padding: "2px 8px",
                margin: "0 8px",
                borderRadius: "4px",
                width: "200px",
                outline: "none",
                textAlign: "center"
              }}
              placeholder="核心主题"
            />
            的演示文稿。
            <br />
            这份文稿的核心目的是为了进行一次
            <select
              value={fields.purpose}
              onChange={(e) => updateField("purpose", e.target.value)}
              style={{
                background: "var(--bg-darker)",
                border: "none",
                borderBottom: "2px solid var(--accent-cyan)",
                color: "var(--text-primary)",
                fontSize: "15px",
                fontWeight: 600,
                padding: "4px 8px",
                margin: "0 8px",
                borderRadius: "4px",
                outline: "none",
                cursor: "pointer"
              }}
            >
              <option value="汇报">工作汇报</option>
              <option value="路演">融资路演</option>
              <option value="培训">业务培训</option>
              <option value="销售">产品销售</option>
              <option value="复盘">项目复盘</option>
            </select>
            。
            <br />
            我们期望的主要听众是
            <select
              value={fields.audience}
              onChange={(e) => updateField("audience", e.target.value)}
              style={{
                background: "var(--bg-darker)",
                border: "none",
                borderBottom: "2px solid var(--accent-cyan)",
                color: "var(--text-primary)",
                fontSize: "15px",
                fontWeight: 600,
                padding: "4px 8px",
                margin: "0 8px",
                borderRadius: "4px",
                outline: "none",
                cursor: "pointer"
              }}
            >
              <option value="老板">管理层老板</option>
              <option value="客户">意向客户</option>
              <option value="投资人">机构投资人</option>
              <option value="学生">外部学员/学生</option>
              <option value="团队成员">团队日常协作成员</option>
            </select>
            。
            <br />
            我们预计在
            <select
              value={fields.duration}
              onChange={(e) => updateField("duration", e.target.value)}
              style={{
                background: "var(--bg-darker)",
                border: "none",
                borderBottom: "2px solid var(--accent-cyan)",
                color: "var(--text-primary)",
                fontSize: "15px",
                fontWeight: 600,
                padding: "4px 8px",
                margin: "0 8px",
                borderRadius: "4px",
                outline: "none",
                cursor: "pointer"
              }}
            >
              <option value="10分钟">10分钟 (精炼速览)</option>
              <option value="20分钟">20分钟 (常规汇报)</option>
              <option value="40分钟">40分钟 (深度分享)</option>
            </select>
            内完成陈述，
            并且在演讲过程中
            <select
              value={fields.script}
              onChange={(e) => updateField("script", e.target.value)}
              style={{
                background: "var(--bg-darker)",
                border: "none",
                borderBottom: "2px solid var(--accent-cyan)",
                color: "var(--text-primary)",
                fontSize: "15px",
                fontWeight: 600,
                padding: "4px 8px",
                margin: "0 8px",
                borderRadius: "4px",
                outline: "none",
                cursor: "pointer"
              }}
            >
              <option value="需要">需要 (同步生成备注讲稿)</option>
              <option value="不需要">不需要 (纯看板幻灯片)</option>
            </select>
            提供备注讲稿。
            <br />
            在排版视觉上，我们期望文稿呈现出
            <select
              value={fields.style}
              onChange={(e) => updateField("style", e.target.value)}
              style={{
                background: "var(--bg-darker)",
                border: "none",
                borderBottom: "2px solid var(--accent-cyan)",
                color: "var(--text-primary)",
                fontSize: "15px",
                fontWeight: 600,
                padding: "4px 8px",
                margin: "0 8px",
                borderRadius: "4px",
                outline: "none",
                cursor: "pointer"
              }}
            >
              <option value="专业简洁">极简北欧风 (Professional)</option>
              <option value="科技酷炫">黑客科技风 (Midnight)</option>
              <option value="故事化">温暖落日风 (Sunset)</option>
              <option value="咨询风">商务蔚蓝风 (Ocean)</option>
            </select>
            的独特质感。
          </div>
        </div>

        <div style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleConfirmReady}
            className="primary-btn"
            style={{
              padding: "12px 24px",
              background: "var(--accent-cyan)",
              border: "none",
              borderRadius: "8px",
              color: "#fff",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(14, 165, 233, 0.2)",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            确认并锁定 Brief (Ready)
          </button>
        </div>
      </div>

      {/* 右侧：实时渲染预览 */}
      <div className="brief-preview-right" style={{
        width: "320px",
        padding: "32px",
        background: "rgba(0, 0, 0, 0.05)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column"
      }}>
        <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "var(--text-muted)", letterSpacing: "0.1em" }}>
          📄 BREF.MD 实时编译预览
        </h4>
        <div className="brief-markdown-preview" style={{
          flex: 1,
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          color: "var(--text-secondary)",
          background: "var(--bg-darker)",
          padding: "20px",
          borderRadius: "8px",
          border: "1px solid var(--border-glass)",
          whiteSpace: "pre-wrap",
          lineHeight: "1.6"
        }}>
          {briefArtifact.content}
        </div>
      </div>
    </div>
  );
};
