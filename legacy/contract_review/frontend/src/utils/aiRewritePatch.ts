export type TableAppendPatchAnalysis = {
  patchStrategy: 'append_after_table'
  anchorPrefix: string
  tableMarkdown: string
  insertText: string
  displayBeforeText: string
}

const TABLE_SEPARATOR_RE = /\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?/

function compactText(value: string) {
  return String(value || '').replace(/\s+/g, '')
}

function looksLikeMarkdownTableLine(line: string) {
  const trimmed = String(line || '').trim()
  return trimmed.startsWith('|') && (trimmed.match(/\|/g)?.length || 0) >= 2
}

function extractMarkdownTableParts(value: string) {
  const text = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!text) return { prefix: '', table: '', suffix: '' }

  const lines = text.split('\n')
  let start = -1
  let end = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (!looksLikeMarkdownTableLine(lines[i])) continue
    start = i
    end = i + 1
    while (end < lines.length && looksLikeMarkdownTableLine(lines[end])) end += 1
    break
  }

  if (start >= 0) {
    return {
      prefix: lines.slice(0, start).join('\n').trim(),
      table: lines.slice(start, end).join('\n').trim(),
      suffix: lines.slice(end).join('\n').trim(),
    }
  }

  const separatorMatch = text.match(TABLE_SEPARATOR_RE)
  if (!separatorMatch || separatorMatch.index == null) {
    return { prefix: text, table: '', suffix: '' }
  }
  const firstPipe = text.indexOf('|')
  if (firstPipe < 0 || firstPipe > separatorMatch.index) {
    return { prefix: text, table: '', suffix: '' }
  }
  return {
    prefix: text.slice(0, firstPipe).trim(),
    table: text.slice(firstPipe).trim(),
    suffix: '',
  }
}

function tableTokens(tableText: string) {
  return String(tableText || '')
    .split('|')
    .map((part) => part.replace(/\s+/g, '').trim())
    .filter(Boolean)
    .filter((part) => !/^:?-{3,}:?$/.test(part))
}

function tableTokenOverlapRatio(left: string, right: string) {
  const leftTokens = Array.from(new Set(tableTokens(left)))
  if (leftTokens.length === 0) return 0
  const rightCompact = compactText(right)
  const hits = leftTokens.filter((token) => token && rightCompact.includes(token)).length
  return hits / leftTokens.length
}

export function analyzeTableAppendPatch(targetText: string, revisedText: string): TableAppendPatchAnalysis | null {
  const before = extractMarkdownTableParts(targetText)
  const after = extractMarkdownTableParts(revisedText)
  if (!before.table || !after.table) return null

  const insertText = String(after.suffix || '').trim()
  if (!insertText) return null
  if (String(before.suffix || '').trim()) return null

  const beforePrefix = compactText(before.prefix)
  const afterPrefix = compactText(after.prefix)
  if (beforePrefix && afterPrefix && !afterPrefix.includes(beforePrefix) && !beforePrefix.includes(afterPrefix)) {
    return null
  }

  const overlap = Math.max(
    tableTokenOverlapRatio(before.table, after.table),
    tableTokenOverlapRatio(after.table, before.table)
  )
  if (overlap < 0.55) return null

  if (compactText(targetText).includes(compactText(insertText))) return null

  const displayPrefix = String(after.prefix || before.prefix || '').trim()
  const displayTable = String(after.table || before.table || '').trim()
  const displayBeforeText = [displayPrefix, displayTable].filter(Boolean).join('\n\n').trim()

  return {
    patchStrategy: 'append_after_table',
    anchorPrefix: String(before.prefix || after.prefix || '').trim(),
    tableMarkdown: String(before.table || after.table || '').trim(),
    insertText,
    displayBeforeText,
  }
}

export function isTableAppendPatch(targetText: string, revisedText: string) {
  return Boolean(analyzeTableAppendPatch(targetText, revisedText))
}
