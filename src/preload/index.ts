import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "@shared/ipc";

const api: DesktopApi = {
  getSessionState: () => ipcRenderer.invoke("session:get-state"),
  createSession: () => ipcRenderer.invoke("session:create"),
  selectSession: (sessionId) => ipcRenderer.invoke("session:select", sessionId),
  deleteSession: (sessionId) => ipcRenderer.invoke("session:delete", sessionId),
  saveSessionMessages: (sessionId, messages) =>
    ipcRenderer.invoke("session:save-messages", sessionId, messages),
  getPresentation: () => ipcRenderer.invoke("presentation:get"),
  startAgentRun: (request, model, executionStrategy) =>
    ipcRenderer.invoke("agent:start", request, model, executionStrategy),
  resumeAgentRun: (threadId, approved) => ipcRenderer.invoke("agent:resume", threadId, approved),
  undo: () => ipcRenderer.invoke("presentation:undo"),
  redo: () => ipcRenderer.invoke("presentation:redo"),
  executeCommand: (command) => ipcRenderer.invoke("presentation:execute", command),
  exportPresentation: (presentation, options) =>
    ipcRenderer.invoke("presentation:export", presentation, options),
};

contextBridge.exposeInMainWorld("desktopApi", api);
