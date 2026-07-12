import React, { useMemo, useState } from "react";
import type { AgentQuestion, AgentQuestionOption, AgentQuestionResolved } from "@shared/agent-question";

interface AgentQuestionCardProps {
  question: AgentQuestion;
  disabled?: boolean;
  onResolve: (resolved: AgentQuestionResolved) => void;
}

function optionSubmitValue(option: AgentQuestionOption): string {
  return option.value?.trim() || option.title;
}

function formatOptionLabel(options: AgentQuestionOption[]): string {
  return options.map((option) => option.title).join("、");
}

export const AgentQuestionCard: React.FC<AgentQuestionCardProps> = ({
  question,
  disabled = false,
  onResolve,
}) => {
  const options = question.options ?? [];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const resolved = question.resolved;
  const isMultiple = question.selectionMode === "multiple";
  const interactive = !disabled && !resolved;
  const showFreeText = question.variant === "markdown" || question.allowFreeText === true;

  const selectedOptions = useMemo(
    () => options.filter((option) => selectedIds.includes(option.id)),
    [options, selectedIds],
  );

  const resolveWithOptions = (nextOptions: AgentQuestionOption[]) => {
    if (nextOptions.length === 0) return;
    const value = nextOptions.map(optionSubmitValue).join("\n");
    onResolve({
      optionIds: nextOptions.map((option) => option.id),
      value,
      label: formatOptionLabel(nextOptions),
      resolvedAt: new Date().toISOString(),
    });
  };

  const resolveWithFreeText = () => {
    const optionValue = selectedOptions.map(optionSubmitValue).join("\n");
    const textValue = freeText.trim();
    const value = [optionValue, textValue].filter(Boolean).join("\n");
    if (!interactive || !value) return;
    const optionLabel = formatOptionLabel(selectedOptions);
    const label = [optionLabel, textValue].filter(Boolean).join("；").slice(0, 240);
    onResolve({
      optionIds: selectedIds,
      value,
      label,
      resolvedAt: new Date().toISOString(),
    });
  };

  const toggleOption = (option: AgentQuestionOption) => {
    if (!interactive) return;
    if (!isMultiple) {
      resolveWithOptions([option]);
      return;
    }
    setSelectedIds((prev) =>
      prev.includes(option.id)
        ? prev.filter((id) => id !== option.id)
        : [...prev, option.id],
    );
  };

  const optionClass = (option: AgentQuestionOption) => {
    const selected = selectedIds.includes(option.id) || resolved?.optionIds.includes(option.id);
    const styleClass = question.variant === "cards"
      ? "agent-question-option agent-question-option--card"
      : "agent-question-option agent-question-option--choice";
    return `${styleClass}${selected ? " is-selected" : ""}`;
  };

  return (
    <div className="inline-artifact-card agent-question-card">
      <div className="inline-artifact-card-header">
        <span className="inline-artifact-badge">确认问题</span>
        <span className="inline-artifact-title">需要确认</span>
        {resolved && (
          <span className="inline-artifact-resolved">
            已选择：{resolved.label ?? resolved.value}
          </span>
        )}
      </div>

      {options.length > 0 && (
        <div
          className={
            question.variant === "cards"
              ? "agent-question-options agent-question-options--cards"
              : "agent-question-options agent-question-options--choices"
          }
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={optionClass(option)}
              disabled={!interactive}
              onClick={() => toggleOption(option)}
            >
              <span className="agent-question-option-main">
                {option.badge && <span className="agent-question-option-badge">{option.badge}</span>}
                <strong>{option.title}</strong>
              </span>
              {option.description && (
                <span className="agent-question-option-description">{option.description}</span>
              )}
              {option.detail && (
                <span className="agent-question-option-detail">{option.detail}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {showFreeText && !resolved && (
        <div className="agent-question-free-text">
          <textarea
            value={freeText}
            disabled={!interactive}
            placeholder={question.placeholder || "请输入补充信息"}
            rows={3}
            onChange={(event) => setFreeText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                resolveWithFreeText();
              }
            }}
          />
          <div className="inline-artifact-actions">
            <button
              type="button"
              className="btn-apply"
              disabled={!interactive || (!freeText.trim() && selectedOptions.length === 0)}
              onClick={resolveWithFreeText}
            >
              {question.submitLabel || "提交回答"}
            </button>
          </div>
        </div>
      )}

      {isMultiple && !resolved && !showFreeText && (
        <div className="inline-artifact-actions">
          <button
            type="button"
            className="btn-apply"
            disabled={disabled || selectedOptions.length === 0}
            onClick={() => resolveWithOptions(selectedOptions)}
          >
            {question.submitLabel || "确认选择"}
          </button>
        </div>
      )}
    </div>
  );
};
