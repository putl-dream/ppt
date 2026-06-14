/**
 * 工具加载策略判定边界。
 *
 * 负责根据显式 loadPolicy、Core 白名单和默认规则，把工具分为 core、deferred、
 * runtime 或 disabled，并生成 Runtime 首轮允许携带的最小工具集合。
 *
 * 不执行工具，不做关键词搜索，也不根据单次用户请求临时提升权限。
 */
