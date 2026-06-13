import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "@shared/ipc";

const api: DesktopApi = {
  getPresentation: () => ipcRenderer.invoke("presentation:get"),
  startAgentRun: (request, model) => ipcRenderer.invoke("agent:start", request, model),
  resumeAgentRun: (threadId, approved) => ipcRenderer.invoke("agent:resume", threadId, approved),
  undo: () => ipcRenderer.invoke("presentation:undo"),
  redo: () => ipcRenderer.invoke("presentation:redo"),
  executeCommand: (command) => ipcRenderer.invoke("presentation:execute", command),
};

contextBridge.exposeInMainWorld("desktopApi", api);
