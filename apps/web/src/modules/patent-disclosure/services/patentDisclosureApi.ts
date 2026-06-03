import { apiClient, getApiBaseUrl } from "../../../shared/api/client";
import { getAccessToken } from "../../../shared/auth/token";
import type {
  CreatePatentCaseInput,
  DownloadedBlob,
  GenerateSettings,
  PatentArtifact,
  PatentCase,
  PatentCaseDetail,
  PatentDisclosureHealth,
  PatentGenerationJob,
  PatentMaterial,
  PatentProgressEvent,
} from "../types";

export const PATENT_DISCLOSURE_API_PREFIX = "/patent-disclosure/api";

type RequestControl = {
  signal?: AbortSignal;
};

type EventSourceHandlers = {
  onEvent: (event: PatentProgressEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
};

export function listPatentCases(options: RequestControl = {}) {
  return apiClient
    .get<{ items?: PatentCase[] } | PatentCase[]>(`${PATENT_DISCLOSURE_API_PREFIX}/cases`, {
      signal: options.signal,
      unwrapEnvelope: false,
    })
    .then((payload) => (Array.isArray(payload) ? payload : payload.items || []).map(normalizeCase));
}

export function fetchPatentDisclosureHealth(options: RequestControl = {}) {
  return apiClient.get<PatentDisclosureHealth>(`${PATENT_DISCLOSURE_API_PREFIX}/health`, {
    signal: options.signal,
    unwrapEnvelope: false,
  });
}

export function createPatentCase(input: CreatePatentCaseInput) {
  return apiClient.post<PatentCase>(`${PATENT_DISCLOSURE_API_PREFIX}/cases`, normalizeCaseInput(input), {
    unwrapEnvelope: false,
  }).then(normalizeCase);
}

export function fetchPatentCase(caseId: string, options: RequestControl = {}) {
  return apiClient
    .get<{ case?: PatentCase } | PatentCase>(`${PATENT_DISCLOSURE_API_PREFIX}/cases/${encodeURIComponent(caseId)}`, {
      signal: options.signal,
      unwrapEnvelope: false,
    })
    .then((payload) => normalizeCase("case" in payload && payload.case ? payload.case : payload as PatentCase));
}

export function fetchPatentCaseDetail(caseId: string, options: RequestControl = {}) {
  return apiClient
    .get<PatentCaseDetail>(`${PATENT_DISCLOSURE_API_PREFIX}/cases/${encodeURIComponent(caseId)}`, {
      signal: options.signal,
      unwrapEnvelope: false,
    })
    .then((payload) => ({
      ...payload,
      case: normalizeCase(payload.case),
      materials: (payload.materials || []).map(normalizeMaterial),
      artifacts: (payload.artifacts || []).map(normalizeArtifact),
    }));
}

export function listCaseMaterials(caseId: string, options: RequestControl = {}) {
  return apiClient
    .get<{ items?: PatentMaterial[] } | PatentMaterial[]>(
      `${PATENT_DISCLOSURE_API_PREFIX}/cases/${encodeURIComponent(caseId)}/materials`,
      { signal: options.signal, unwrapEnvelope: false },
    )
    .then((payload) => (Array.isArray(payload) ? payload : payload.items || []).map(normalizeMaterial));
}

export function uploadCaseMaterials(caseId: string, files: File[], category = "source") {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  form.append("materialType", category);
  return apiClient.post<{ items?: PatentMaterial[] } | PatentMaterial[]>(
    `${PATENT_DISCLOSURE_API_PREFIX}/cases/${encodeURIComponent(caseId)}/materials`,
    form,
    { unwrapEnvelope: false },
  ).then((payload) => (Array.isArray(payload) ? payload : payload.items || []).map(normalizeMaterial));
}

export function startPatentDisclosureGeneration(caseId: string, settings: GenerateSettings) {
  return apiClient.post<PatentGenerationJob>(
    `${PATENT_DISCLOSURE_API_PREFIX}/cases/${encodeURIComponent(caseId)}/generate`,
    {
      outputFormats: settings.outputFormat === "docx" ? ["docx"] : ["md", "docx"],
      includeMermaid: true,
      renderMermaidPng: true,
      anonymize: settings.enableDesensitization,
      extraInstruction: [settings.technicalField, settings.claimFocus, settings.additionalInstructions]
        .filter(Boolean)
        .join("\n"),
    },
    { unwrapEnvelope: false },
  );
}

export function fetchPatentGenerationJob(jobId: string, options: RequestControl = {}) {
  return apiClient.get<PatentGenerationJob>(
    `${PATENT_DISCLOSURE_API_PREFIX}/jobs/${encodeURIComponent(jobId)}`,
    { signal: options.signal, unwrapEnvelope: false },
  );
}

export function listCaseArtifacts(caseId: string, options: RequestControl = {}) {
  return apiClient
    .get<{ items?: PatentArtifact[] } | PatentArtifact[]>(
      `${PATENT_DISCLOSURE_API_PREFIX}/cases/${encodeURIComponent(caseId)}/artifacts`,
      { signal: options.signal, unwrapEnvelope: false },
    )
    .then((payload) => (Array.isArray(payload) ? payload : payload.items || []).map(normalizeArtifact));
}

export async function downloadArtifact(artifact: PatentArtifact): Promise<DownloadedBlob> {
  if (artifact.downloadUrl) {
    const response = await apiClient.raw("GET", artifact.downloadUrl, {
      headers: { Accept: artifact.mimeType || "application/octet-stream" },
    });
    return buildDownload(response, artifact.name);
  }

  const path = `${PATENT_DISCLOSURE_API_PREFIX}/artifacts/${encodeURIComponent(artifact.id)}/download`;
  const response = await apiClient.raw("GET", path, {
    headers: { Accept: artifact.mimeType || "application/octet-stream" },
  });
  return buildDownload(response, artifact.name);
}

export function saveBlobToDisk(download: DownloadedBlob) {
  const objectUrl = URL.createObjectURL(download.blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = download.fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function openJobProgressEventSource(jobId: string, handlers: EventSourceHandlers) {
  const url = buildSseUrl(`${PATENT_DISCLOSURE_API_PREFIX}/jobs/${encodeURIComponent(jobId)}/stream`);
  const source = new EventSource(url, { withCredentials: true });

  source.onopen = () => handlers.onOpen?.();
  source.onmessage = (message) => {
    const event = parseProgressEvent(message.data);
    if (event) {
      handlers.onEvent(event);
    }
  };
  source.addEventListener("progress", (message) => {
    const event = parseProgressEvent((message as MessageEvent).data);
    if (event) {
      handlers.onEvent(event);
    }
  });
  source.addEventListener("done", (message) => {
    const event = parseProgressEvent((message as MessageEvent).data) || { status: "completed", type: "done" };
    handlers.onEvent(event);
    source.close();
  });
  source.addEventListener("error", (message) => {
    const event = parseProgressEvent((message as MessageEvent).data);
    if (event) {
      handlers.onEvent(event);
    }
  });
  source.onerror = (error) => handlers.onError?.(error);

  return source;
}

function buildSseUrl(path: string) {
  const base = getApiBaseUrl();
  const target = new URL(`${base}/${path.replace(/^\/+/, "")}`, window.location.origin);
  const token = getAccessToken();
  if (token) {
    target.searchParams.set("access_token", token);
  }
  return target.toString();
}

function parseProgressEvent(data: string): PatentProgressEvent | null {
  if (!data || data === "[DONE]") {
    return data === "[DONE]" ? { status: "completed", type: "done" } : null;
  }
  try {
    return JSON.parse(data) as PatentProgressEvent;
  } catch {
    return { message: data };
  }
}

function normalizeCaseInput(input: CreatePatentCaseInput) {
  return {
    title: input.title,
    technicalTopic: input.technicalField || "",
    applicant: input.owner || "",
    projectName: input.projectName || "",
    description: input.summary || "",
    anonymize: false,
  };
}

function normalizeCase(item: PatentCase): PatentCase {
  return {
    ...item,
    technicalField: item.technicalField || item.technicalTopic || "",
    owner: item.owner || item.applicant || "",
    summary: item.summary || item.description || "",
  };
}

function normalizeMaterial(item: PatentMaterial): PatentMaterial {
  return {
    ...item,
    fileName: item.fileName || item.filename || "",
    fileSize: item.fileSize ?? item.sizeBytes ?? 0,
  };
}

function normalizeArtifact(item: PatentArtifact): PatentArtifact {
  return {
    ...item,
    name: item.name || item.filename || "",
    size: item.size ?? item.sizeBytes ?? 0,
  };
}

async function buildDownload(response: Response, fallbackName: string): Promise<DownloadedBlob> {
  return {
    blob: await response.blob(),
    fileName: pickFileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackName),
  };
}

function pickFileNameFromDisposition(contentDisposition: string | null, fallbackName: string) {
  if (!contentDisposition) {
    return fallbackName;
  }
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || fallbackName;
}
