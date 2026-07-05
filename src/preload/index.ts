import { contextBridge, ipcRenderer } from "electron";
import type { AgentStreamEvent, DesktopApi } from "@shared/ipc";

const api: DesktopApi = {
  getSessionState: () => ipcRenderer.invoke("session:get-state"),
  createSession: (options) => ipcRenderer.invoke("session:create", options),
  openWorkspace: (rootPath) => ipcRenderer.invoke("workspace:open", rootPath),
  listWorkspaceSessions: (rootPath) => ipcRenderer.invoke("workspace:list-sessions", rootPath),
  migrateLegacySessionToWorkspace: (sessionId, targetRootPath) =>
    ipcRenderer.invoke("workspace:migrate-legacy", sessionId, targetRootPath),
  selectSession: (sessionId) => ipcRenderer.invoke("session:select", sessionId),
  deleteSession: (sessionId) => ipcRenderer.invoke("session:delete", sessionId),
  saveSessionMessages: (sessionId, messages) =>
    ipcRenderer.invoke("session:save-messages", sessionId, messages),
  listProjectArtifacts: (sessionId) => ipcRenderer.invoke("project:list-artifacts", sessionId),
  readProjectArtifact: (sessionId, artifactIdOrPath) =>
    ipcRenderer.invoke("project:read-artifact", sessionId, artifactIdOrPath),
  writeProjectArtifact: (sessionId, relativePath, content) =>
    ipcRenderer.invoke("project:write-artifact", sessionId, relativePath, content),
  getProjectArtifactDiff: (sessionId, relativePath, nextContent) =>
    ipcRenderer.invoke("project:get-artifact-diff", sessionId, relativePath, nextContent),
  markProjectArtifactStatus: (sessionId, artifactId, status) =>
    ipcRenderer.invoke("project:mark-artifact-status", sessionId, artifactId, status),
  getPresentation: () => ipcRenderer.invoke("presentation:get"),
  startAgentRun: (request, model, executionStrategy, stepLimits, gatewayConfig, runId) =>
    ipcRenderer.invoke("agent:start", request, model, executionStrategy, stepLimits, gatewayConfig, runId),
  continueAgentRun: (threadId, request, model, stepLimits, gatewayConfig, runId) =>
    ipcRenderer.invoke("agent:continue", threadId, request, model, stepLimits, gatewayConfig, runId),
  onAgentStream: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, streamEvent: AgentStreamEvent) => {
      listener(streamEvent);
    };
    ipcRenderer.on("agent:stream", handler);
    return () => ipcRenderer.removeListener("agent:stream", handler);
  },
  resumeAgentRun: (sessionId, threadId, approved) =>
    ipcRenderer.invoke("agent:resume", sessionId, threadId, approved),
  undo: () => ipcRenderer.invoke("presentation:undo"),
  redo: () => ipcRenderer.invoke("presentation:redo"),
  executeCommand: (command) => ipcRenderer.invoke("presentation:execute", command),
  exportPresentation: (presentation, options) =>
    ipcRenderer.invoke("presentation:export", presentation, options),
  selectDirectory: (defaultPath) => ipcRenderer.invoke("dialog:select-directory", defaultPath),
  setWindowThemeMode: (themeMode) => ipcRenderer.invoke("window:set-theme-mode", themeMode),
  cancelAgentRun: (runId) => ipcRenderer.invoke("agent:cancel", runId),
  cancelAgentSession: (sessionId) => ipcRenderer.invoke("agent:cancel-session", sessionId),
  resolveToolApproval: (runId, approvalId, approved) =>
    ipcRenderer.invoke("agent:resolve-tool-approval", runId, approvalId, approved),
};

contextBridge.exposeInMainWorld("desktopApi", api);
