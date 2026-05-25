const KNOWN: Record<string, string> = {
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  zsh: "Zsh",
  pwsh: "PowerShell",
  powershell: "PowerShell",
  python: "Python",
  py: "Python",
  javascript: "JavaScript",
  js: "JavaScript",
  jsx: "JavaScript",
  typescript: "TypeScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  sql: "SQL",
  yaml: "YAML",
  yml: "YAML",
  markdown: "Markdown",
  md: "Markdown",
  rust: "Rust",
  go: "Go",
  java: "Java",
  php: "PHP",
  dockerfile: "Dockerfile",
  text: "Text",
  txt: "Text",
  plain: "Text",
  plaintext: "Text",
};

function titleCaseId(id: string): string {
  if (!id) return "";
  if (id.length <= 4 && id === id.toLowerCase()) return id.toUpperCase();
  return id.charAt(0).toUpperCase() + id.slice(1).toLowerCase();
}

/** 从 `language-xxx` 得到界面展示名；无法识别则 `null`。 */
export function languageLabelFromCodeClassName(className: string | undefined): string | null {
  if (!className || typeof className !== "string") return null;
  const lang = className
    .split(/\s+/)
    .map((c) => c.trim())
    .find((c) => c.startsWith("language-"))
    ?.slice("language-".length)
    .trim();
  if (!lang) return null;
  const lower = lang.toLowerCase();
  if (KNOWN[lower]) return KNOWN[lower];
  if (/^[a-z0-9+#.-]{1,32}$/i.test(lang)) {
    return titleCaseId(lower.replace(/\+/g, "plus"));
  }
  return null;
}
