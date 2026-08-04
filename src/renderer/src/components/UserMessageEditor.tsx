import type React from "react";
import { CHAT_WORKSPACE_COPY_ZH_CN as copy } from "./chat-workspace-copy";

export interface UserMessageEditorProps {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function resizeMessageEditor(textarea: HTMLTextAreaElement) {
  const maxHeight = 320;
  textarea.style.height = "auto";
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

export const UserMessageEditor: React.FC<UserMessageEditorProps> = ({
  value,
  busy,
  onChange,
  onCancel,
  onSubmit,
}) => {
  const canSubmit = !busy && Boolean(value.trim());

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSubmit) onSubmit();
    }
  };

  return (
    <div className="user-message-editor" role="group" aria-label={copy.editor.groupAria}>
      <div className="user-message-editor-header">
        <span className="user-message-editor-title">{copy.editor.title}</span>
        <span className="user-message-editor-hint">{copy.editor.hint}</span>
      </div>
      <textarea
        className="user-message-editor-textarea"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          resizeMessageEditor(event.target);
        }}
        onKeyDown={handleKeyDown}
        ref={(textarea) => {
          if (textarea) resizeMessageEditor(textarea);
        }}
        autoFocus
        rows={3}
        aria-label={copy.editor.textareaAria}
      />
      <div className="user-message-editor-footer">
        <span className="user-message-editor-shortcut">{copy.editor.shortcut}</span>
        <div className="user-message-edit-actions">
          <button type="button" onClick={onCancel} className="message-action-btn">
            {copy.editor.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="message-action-btn message-action-btn--primary"
          >
            {copy.editor.submit}
          </button>
        </div>
      </div>
    </div>
  );
};
