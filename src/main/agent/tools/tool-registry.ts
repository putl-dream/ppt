/**
 * 工具注册表与唯一查询入口。
 *
 * 负责注册、按名称获取、列出 Core/Deferred 工具，以及只在 Deferred Tools 中搜索。
 * Runtime Tools 可以登记供系统使用，但绝不能通过模型搜索结果或执行器暴露。
 */
