import { registerHook } from "./hook-registry";
import { createPermissionPreToolUseHook } from "../tools/permission-check";

let defaultsRegistered = false;

/** 注册默认 hook（幂等）。权限检查挂在 PreToolUse 上。 */
export function ensureDefaultHooks(): void {
  if (defaultsRegistered) return;
  registerHook("PreToolUse", createPermissionPreToolUseHook());
  defaultsRegistered = true;
}

/** 仅用于测试：重置默认注册状态。 */
export function resetDefaultHooksForTests(): void {
  defaultsRegistered = false;
}
