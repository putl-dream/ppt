# Runtime Tools Boundary

本目录只描述系统内部能力，Runtime Tools 不进入模型初始工具集，也不能被
`SearchExtraTools` 或 `ExecuteExtraTool` 发现和调用。

典型能力包括真实命令落盘、保存文件、写历史、更新 revision、覆盖或删除资源。
它们只能由 `workflow`、`commit-gate`、`CommandBus` 或经过授权的主进程服务调用。

本轮不创建具体 Runtime Tool 实现，现有真实修改仍由 `src/shared/commands.ts` 中的
`CommandBus` 承担。
