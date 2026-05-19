/**
 * 按不区分大小写的子串拆成片段，用于在 UI 中高亮匹配部分。
 */
export function splitTextBySearchQuery(
  text: string,
  queryTrimmed: string,
): { match: boolean; segment: string }[] {
  const q = queryTrimmed.trim();
  if (!q) {
    return [{ match: false, segment: text }];
  }
  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const out: { match: boolean; segment: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(qLower, i);
    if (idx === -1) {
      out.push({ match: false, segment: text.slice(i) });
      break;
    }
    if (idx > i) {
      out.push({ match: false, segment: text.slice(i, idx) });
    }
    out.push({
      match: true,
      segment: text.slice(idx, idx + q.length),
    });
    i = idx + q.length;
  }
  return out;
}
