export type TaskType = "IDEIA" | "PESQUISA" | "CRIAR" | "CONSTRUIR" | "OPERAR" | "REVISAR";

export type TaskStatus =
  | "Inbox"
  | "Triagem"
  | "Em andamento"
  | "Bloqueado"
  | "Concluído"
  | "Arquivado";

export type TaskComplexity = "Mecânica" | "Normal" | "Complexa" | "Crítica";
export type TaskRisk = "Baixo" | "Médio" | "Alto";

export type CanonicalSourceKind = "notion" | "github" | "obsidian" | "file" | "url";

export type CanonicalSourceRef = {
  kind: CanonicalSourceKind;
  url: string;
  label?: string;
};

export type KoraTask = {
  id: string;
  project: string;
  type: TaskType;
  status: TaskStatus;
  complexity: TaskComplexity;
  risk: TaskRisk;
  nextAction?: string | null;
  source?: CanonicalSourceRef | null;
  contextPackId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ContextPack = {
  id: string;
  project: string;
  objective: string;
  relevantState?: string | null;
  canonicalSources: CanonicalSourceRef[];
  scope?: string | null;
  files: string[];
  constraints: string[];
  pendingDecision?: string | null;
  definitionOfDone?: string | null;
};

export type ToolCall = {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  project: string;
  risk: TaskRisk;
  requiresConfirmation: boolean;
};

export type JobStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type KoraJob = {
  id: string;
  taskId?: string | null;
  executor: string;
  model?: string | null;
  status: JobStatus;
  startedAt?: string | null;
  updatedAt: string;
  resultRef?: CanonicalSourceRef | null;
  error?: string | null;
};

export type KoraEventType =
  | "job.created"
  | "job.started"
  | "job.progress"
  | "job.completed"
  | "job.failed"
  | "task.updated";

export type KoraEvent<T = unknown> = {
  id: string;
  jobId?: string | null;
  type: KoraEventType;
  timestamp: string;
  payload: T;
};

export type KoraStatus = {
  version: "0.1";
  ready: boolean;
  storage: "pending" | "sqlite";
  eventBus: "tauri";
  taskAdapter: "pending" | "notion";
};
