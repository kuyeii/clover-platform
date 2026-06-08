export function normalizeRiskTextForDisplay(value: unknown) {
  return String(value || '')
    .replace(/[【\[][^【】\[\]\n]{0,160}(?:RULE|TPL|POLICY|CHECK|REG|MODEL|STD|CLAUSE)_[^【】\[\]\n]{1,160}[】\]]\s*/g, '')
    .replace(/(?:^|\s)(?:RULE|TPL|POLICY|CHECK|REG|MODEL|STD|CLAUSE)_[A-Za-z0-9_-]+(?=\s|$)/g, ' ')
    .replace(/segment_[A-Za-z0-9_-]+::[A-Za-z0-9_.()（）-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/([。！？])\s*；+/g, '$1')
    .replace(/；+\s*([。！？])/g, '$1')
    .replace(/；{2,}/g, '；')
    .trim()
}

export function sanitizeAiCommentText(value?: string) {
  return normalizeRiskTextForDisplay(value)
}

export function isSuggestionInsertCommentText(value?: string) {
  return /^建议插入内容\s*[:：]/.test(sanitizeAiCommentText(value))
}
