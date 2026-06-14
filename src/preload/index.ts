import { contextBridge, ipcRenderer } from "electron";
import type { AgentStreamEvent, DesktopApi } from "@shared/ipc";

const api: DesktopApi = {
  getSessionState: () => ipcRenderer.invoke("session:get-state"),
  createSession: () => ipcRenderer.invoke("session:create"),
  selectSession: (sessionId) => ipcRenderer.invoke("session:select", sessionId),
  deleteSession: (sessionId) => ipcRenderer.invoke("session:delete", sessionId),
  saveSessionMessages: (sessionId, messages) =>
    ipcRenderer.invoke("session:save-messages", sessionId, messages),
  getPresentation: () => ipcRenderer.invoke("presentation:get"),
  startAgentRun: (request, model, executionStrategy, runId) =>
    ipcRenderer.invoke("agent:start", request, model, executionStrategy, runId),
  continueAgentRun: (threadId, request, runId) =>
    ipcRenderer.invoke("agent:continue", threadId, request, runId),
  confirmAgentOutline: (threadId, runId) =>
    ipcRenderer.invoke("agent:confirm-outline", threadId, runId),
  onAgentStream: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, streamEvent: AgentStreamEvent) => {
      listener(streamEvent);
    };
    ipcRenderer.on("agent:stream", handler);
    return () => ipcRenderer.removeListener("agent:stream", handler);
  },
  resumeAgentRun: (threadId, approved) => ipcRenderer.invoke("agent:resume", threadId, approved),
  undo: () => ipcRenderer.invoke("presentation:undo"),
  redo: () => ipcRenderer.invoke("presentation:redo"),
  executeCommand: (command) => ipcRenderer.invoke("presentation:execute", command),
  exportPresentation: (presentation, options) =>
    ipcRenderer.invoke("presentation:export", presentation, options),
};

contextBridge.exposeInMainWorld("desktopApi", api);
