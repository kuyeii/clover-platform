export type UserFacingError = {
  title: string
  message: string
  code?: string
  status?: number
}

type ApiErrorEnvelope = {
  detail?: unknown
  error?: {
    code?: string
    title?: string
    message?: string
    user_message?: string
    status?: number
  }
}

type ErrorRule = {
  code?: string
  match?: RegExp
  status?: number
  title: string
  message: string
}

const ERROR_RULES: ErrorRule[] = [
  {
    code: 'UNSUPPORTED_FILE_TYPE',
    title: '文件格式不支持',
    message: '请上传 PDF 或 Word（.doc/.docx）格式的合同文件后再试。'
  },
  {
    code: 'REQUEST_VALIDATION_ERROR',
    title: '提交信息不完整',
    message: '请检查上传文件和必填项后重试。'
  },
  {
    code: 'REVIEW_NOT_FOUND',
    title: '审查记录不存在',
    message: '未找到对应的审查记录，请返回首页重新上传合同。'
  },
  {
    code: 'REVIEW_NOT_READY',
    title: '审查尚未完成',
    message: '合同还在处理中，请稍后再试。'
  },
  {
    code: 'RISK_NOT_FOUND',
    title: '风险项不存在',
    message: '未找到对应的风险项，请刷新页面后再试。'
  },
  {
    match: /当前没有可操作的 run_id/i,
    title: '请先发起审查',
    message: '当前还没有可操作的审查记录，请先上传合同并开始审查。'
  },
  {
    match: /run_id\s*不存在|审查记录不存在/i,
    title: '审查记录不存在',
    message: '未找到对应的审查记录，请返回首页重新上传合同。'
  },
  {
    match: /risk_id\s*不存在/i,
    title: '风险项不存在',
    message: '未找到对应的风险项，请刷新页面后再试。'
  },
  {
    match: /仅支持\s*\.docx|支持\s*\.pdf|unsupported.+docx|unsupported.+pdf|文件格式/i,
    title: '文件格式不支持',
    message: '请上传 PDF 或 Word（.doc/.docx）格式的合同文件后再试。'
  },
  {
    match: /任务尚未完成|结果尚未生成完成|still processing/i,
    title: '审查尚未完成',
    message: '合同还在处理中，请稍后再试。'
  }
]

function cleanText(value: string) {
  return value
    .replace(/^error:\s*/i, '')
    .replace(/^[^：:\n]{0,24}(?:失败|异常|错误)[:：]\s*/, '')
    .trim()
}

function pickText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return cleanText(value)
  if (value instanceof Error) return cleanText(value.message)
  if (Array.isArray(value)) {
    return value.map((item) => pickText(item)).filter(Boolean).join('；')
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['user_message', 'message', 'detail', 'msg']) {
      const text = pickText(record[key])
      if (text) return text
    }
    const flattened = Object.values(record).map((item) => pickText(item)).filter(Boolean)
    return flattened[0] || ''
  }
  return cleanText(String(value))
}

function findRule(params: { code?: string; status?: number; detailText?: string }) {
  const { code, status, detailText } = params
  if (code) {
    const matchedByCode = ERROR_RULES.find((rule) => rule.code === code)
    if (matchedByCode) return matchedByCode
  }
  if (detailText) {
    const matchedByPattern = ERROR_RULES.find((rule) => rule.match?.test(detailText))
    if (matchedByPattern) return matchedByPattern
  }
  if (status) {
    return ERROR_RULES.find((rule) => rule.status === status) || null
  }
  return null
}

function defaultTitle(status?: number) {
  if (status === 400 || status === 422) return '提交内容有误'
  if (status === 404) return '内容不存在'
  if (status === 409) return '当前状态暂不可操作'
  if (status && status >= 500) return '服务暂时不可用'
  return '操作未完成'
}

function defaultMessage(status?: number) {
  if (status === 400 || status === 422) return '请检查输入内容后重试。'
  if (status === 404) return '请求的内容不存在或已失效，请返回上一步重试。'
  if (status === 409) return '当前状态暂不支持该操作，请稍后再试。'
  if (status && status >= 500) return '服务开小差了，请稍后重试。'
  return '操作未完成，请稍后重试。'
}

function isUserFacingError(value: unknown): value is UserFacingError {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.title === 'string' && typeof record.message === 'string'
}

function buildUserFacingError(params: {
  status?: number
  code?: string
  title?: string
  message?: string
  fallbackTitle?: string
  fallbackMessage?: string
  detailText?: string
}): UserFacingError {
  const { status, code, title, message, fallbackTitle, fallbackMessage, detailText } = params
  const rule = findRule({ code, status, detailText })

  return {
    status,
    code: code || rule?.code,
    title: title || rule?.title || fallbackTitle || defaultTitle(status),
    message:
      message ||
      rule?.message ||
      detailText ||
      fallbackMessage ||
      defaultMessage(status),
  }
}

export async function readApiError(
  resp: Response,
  fallback?: { title?: string; message?: string }
): Promise<UserFacingError> {
  const rawText = await resp.text()
  let parsed: ApiErrorEnvelope | null = null

  try {
    parsed = rawText ? (JSON.parse(rawText) as ApiErrorEnvelope) : null
  } catch {
    parsed = null
  }

  const status = resp.status
  const code = String(parsed?.error?.code || '').trim() || undefined
  const title = String(parsed?.error?.title || '').trim() || undefined
  const explicitMessage =
    String(parsed?.error?.message || parsed?.error?.user_message || '').trim() || undefined
  const detailText = pickText(explicitMessage || parsed?.detail || rawText)

  return buildUserFacingError({
    status,
    code,
    title,
    message: explicitMessage,
    fallbackTitle: fallback?.title,
    fallbackMessage: fallback?.message,
    detailText,
  })
}

export function toUserFacingError(
  error: unknown,
  fallback?: { title?: string; message?: string; status?: number }
): UserFacingError {
  if (isUserFacingError(error)) {
    return buildUserFacingError({
      status: error.status ?? fallback?.status,
      code: error.code,
      title: error.title,
      message: error.message,
      fallbackTitle: fallback?.title,
      fallbackMessage: fallback?.message,
      detailText: error.message,
    })
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const status = typeof record.status === 'number' ? record.status : fallback?.status
    const code = String(record.code || '').trim() || undefined
    const title = typeof record.title === 'string' ? record.title.trim() || undefined : undefined
    const message = typeof record.message === 'string' ? record.message.trim() || undefined : undefined
    const detailText = pickText(message || record.detail || error)
    return buildUserFacingError({
      status,
      code,
      title,
      message,
      fallbackTitle: fallback?.title,
      fallbackMessage: fallback?.message,
      detailText,
    })
  }

  const detailText = pickText(error)
  return buildUserFacingError({
    status: fallback?.status,
    fallbackTitle: fallback?.title,
    fallbackMessage: fallback?.message,
    detailText,
  })
}
