export type PatentCaseStatus =
  | "draft"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "archived"
  | string;

export type PatentCase = {
  id: string;
  title: string;
  status: PatentCaseStatus;
  inventionType?: "invention" | "utility_model" | "design" | string;
  technicalField?: string;
  technicalTopic?: string;
  owner?: string;
  applicant?: string;
  projectName?: string;
  description?: string;
  inventor?: string;
  contact?: string;
  summary?: string;
  materialCount?: number;
  artifactCount?: number;
  activeJobId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type PatentMaterial = {
  id: string;
  caseId?: string;
  filename?: string;
  fileName: string;
  sizeBytes?: number;
  fileSize?: number;
  mimeType?: string;
  category?: string;
  materialType?: "source" | "reference" | "existing" | string;
  parseStatus?: string;
  status?: string;
  uploadedAt?: string;
};

export type GenerateSettings = {
  patentType: "invention" | "utility_model" | "design";
  includePriorArtSearch: boolean;
  enableDesensitization: boolean;
  outputFormat: "docx" | "markdown_docx";
  technicalField: string;
  claimFocus: string;
  additionalInstructions: string;
};

export type PatentGenerationJob = {
  id: string;
  caseId: string;
  jobType?: "generate_disclosure" | "revise_disclosure" | string;
  status: "pending" | "running" | "succeeded" | "failed" | string;
  progress?: number;
  step?: string;
  currentStep?: string;
  message?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PatentCaseDetail = {
  case: PatentCase;
  materials: PatentMaterial[];
  latestJob?: PatentGenerationJob | null;
  artifacts: PatentArtifact[];
};

export type PatentDisclosureHealth = {
  ok: boolean;
  module: string;
  skillFound: boolean;
  openaiCompatibleConfigured: boolean;
  cnipaAvailable: boolean;
  docxExportAvailable: boolean;
  repoPackAvailable?: boolean;
  mermaidRenderAvailable?: boolean;
  sseEnabled: boolean;
};

export type PatentProgressEvent = {
  type?: string;
  event?: string;
  status?: PatentGenerationJob["status"];
  progress?: number;
  step?: string;
  currentStep?: string;
  message?: string;
  artifact?: PatentArtifact;
  artifacts?: PatentArtifact[];
  error?: string;
};

export type PatentArtifact = {
  id: string;
  caseId?: string;
  jobId?: string;
  name: string;
  filename?: string;
  artifactType?: string;
  kind?: "markdown" | "docx" | "prior_art" | "log" | string;
  versionNo?: number;
  mimeType?: string;
  size?: number;
  sizeBytes?: number;
  createdAt?: string;
  downloadUrl?: string;
};

export type CreatePatentCaseInput = {
  title: string;
  technicalField?: string;
  projectName?: string;
  inventionType?: string;
  owner?: string;
  inventor?: string;
  contact?: string;
  summary?: string;
};

export type DownloadedBlob = {
  blob: Blob;
  fileName: string;
};
