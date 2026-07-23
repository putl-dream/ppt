const SHORT_EXPORT_COMMAND_PATTERN =
  /^(?:请|帮我|麻烦)?\s*(?:导出|下载|保存)(?:一下|吧)?[。.!！]?$/i;

const VERB_FIRST_EXPORT_PATTERN =
  /(?:^|[\s，,。；;！!])(?:请|帮我|麻烦|现在|直接|立即)?\s*(?:导出|下载|保存)(?:当前|这份|这个|本|已生成的|已有的)?[^。！？!?]{0,16}(?:pptx|ppt|演示文稿|幻灯片|deck|文件|html|网页|json)/i;

const OBJECT_FIRST_EXPORT_PATTERN =
  /(?:^|[\s，,。；;！!])(?:请|帮我|麻烦|现在|直接|立即)?\s*(?:把|将)?(?:当前|这份|这个|本|已生成的|已有的)?\s*(?:pptx|ppt|演示文稿|幻灯片|deck|文件)\s*(?:导出|下载|保存)(?:为|成|到|一下|文件|pptx|html|网页|json|\s|[。.!！]|$)/i;

const EXPORT_CAPABILITY_CONTEXT_PATTERN =
  /(?:从[^。！？!?]{0,24}到导出|导出[^。！？!?]{0,12}(?:能力|阶段|流程|展示|演讲|分享|功能)|(?:能力|阶段|流程|展示|演讲|分享|功能)[^。！？!?]{0,12}导出)/i;

export function isExplicitExportPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (EXPORT_CAPABILITY_CONTEXT_PATTERN.test(text)) return false;
  return SHORT_EXPORT_COMMAND_PATTERN.test(text)
    || VERB_FIRST_EXPORT_PATTERN.test(text)
    || OBJECT_FIRST_EXPORT_PATTERN.test(text);
}
