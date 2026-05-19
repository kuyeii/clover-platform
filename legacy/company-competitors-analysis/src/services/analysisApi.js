export async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Keep payload null and use a generic message below.
  }

  if (!response.ok) {
    throw new Error(payload?.message || `请求失败（HTTP ${response.status}）`);
  }

  return payload;
}

export async function runAnalysis(input) {
  return requestJson("/api/analysis", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function runAnalysisStream(input, onEvent) {
  const response = await fetch("/api/analysis/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok || !response.body) {
    throw new Error(`请求失败（HTTP ${response.status}）`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line));
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    onEvent(JSON.parse(buffer));
  }
}

export async function listHistory() {
  const payload = await requestJson("/api/history");
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function getHistoryRecord(id) {
  const payload = await requestJson(`/api/history/${encodeURIComponent(id)}`);
  return payload.item || null;
}
