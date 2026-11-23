/**
 * Dev-only demo: open http://localhost:1420/?demo to see the real dock in a
 * browser with sample readings. It stands in for the Tauri bridge, so nothing
 * here ships: production builds never load it.
 */
type Handler = (args: Record<string, unknown>) => unknown;

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const win = (id: string, label: string, remainingPercent: number, resetInHours: number) => ({
  id,
  label,
  remainingPercent,
  resetAt: hours(resetInHours)
});
const account = (id: string, name: string, email: string, gemini: number, claude: number) => ({
  id,
  name,
  connected: true,
  plan: "Google AI Pro",
  email,
  error: null,
  windows: [
    win("gemini-session", "Gemini · 5h", gemini, 3),
    win("gemini-weekly", "Gemini · Semanal", Math.min(100, gemini + 10), 70),
    win("claude-gpt-session", "Claude + GPT · 5h", claude, 2),
    win("claude-gpt-weekly", "Claude + GPT · Semanal", Math.min(100, claude + 15), 70)
  ]
});

const usage = [
  {
    id: "claude",
    name: "Claude",
    connected: true,
    plan: "Max",
    error: null,
    windows: [win("session", "Sessão · 5h", 62, 2.2), win("weekly", "Semanal", 28, 98)]
  },
  {
    id: "codex",
    name: "Codex",
    connected: true,
    plan: "Pro",
    error: null,
    windows: [win("session", "Sessão · 5h", 81, 4), win("weekly", "Semanal", 74, 30)]
  },
  {
    id: "cursor",
    name: "Cursor",
    connected: true,
    plan: "X Premium",
    error: null,
    windows: [win("weekly", "Semanal", 34, 52)]
  },
  account("antigravity", "Antigravity · Conta 1 (Principal)", "conta1@example.com", 46, 30),
  account("antigravity-2", "Antigravity · Conta 2", "conta2@example.com", 72, 65),
  account("antigravity-3", "Antigravity · Conta 3", "conta3@example.com", 91, 84),
  account("antigravity-4", "Antigravity · Conta 4", "conta1@example.com", 12, 8),
  {
    id: "grok",
    name: "Grok",
    connected: true,
    plan: "X Premium",
    error: null,
    windows: [win("weekly", "Semanal", 12, 52)]
  }
];

function demoCosts() {
  const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
  const rows = [
    ["claude", "claude-opus-5-5", "ai-dock", 8.4],
    ["claude", "claude-sonnet-5-5", "site-medina", 3.1],
    ["codex", "gpt-6-codex", "ai-dock", 2.2],
    ["claude", "claude-opus-5-5", "nave-seguidores", 5.6],
    ["codex", "gpt-6-codex", "dm-automation", 1.4]
  ] as const;
  return Array.from({ length: 7 }, (_, back) =>
    rows.map(([provider, model, project, cost], index) => ({
      date: day(back),
      provider,
      model,
      project,
      inputTokens: 120_000 * (index + 1),
      outputTokens: 18_000 * (index + 1),
      cacheWriteTokens: 40_000,
      cacheReadTokens: 900_000,
      costUsd: Math.round(cost * (1 + ((back * 7 + index) % 5) / 6) * 100) / 100
    }))
  ).flat();
}

const handlers: Record<string, Handler> = {
  get_provider_usage: () => usage,
  get_antigravity_account_pins: () => ({ "antigravity-4": "conta4@example.com" }),
  get_provider_activity: () => [
    {
      providerId: "claude",
      state: "working",
      confidence: "high",
      sessions: [
        { id: "c1", title: "ai-dock", detail: "Editando theme-a.css", state: "working", since: Date.now() - 60_000 },
        { id: "c2", title: "site-medina", detail: "Rodando testes", state: "working", since: Date.now() - 240_000 }
      ]
    },
    {
      providerId: "codex",
      state: "working",
      confidence: "high",
      sessions: [{ id: "x1", title: "Agent Pauli", detail: "Executando tarefa", state: "working", since: Date.now() - 30_000 }]
    }
  ],
  get_provider_status: () => [],
  get_monitors: () => [{ index: 0, name: "Tela 1", width: 1920, height: 1080, scaleFactor: 1 }],
  get_local_costs: () => ({ entries: demoCosts(), prices: "online", files: 42 }),
  provider_setup_status: () => ({ installed: true, authenticated: true, version: "demo", npmAvailable: true }),
  claude_web_status: () => usage[0],
  scan_obsidian_prompts: () => []
};

export function installDemoBridge() {
  let nextId = 1;
  const callbacks = new Map<number, (payload: unknown) => void>();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(callback: (payload: unknown) => void) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    convertFileSrc: (path: string) => path,
    async invoke(cmd: string, args: Record<string, unknown> = {}) {
      const handler = handlers[cmd];
      if (handler) return handler(args);
      if (cmd.startsWith("plugin:event|listen")) return nextId++;
      return null;
    }
  };
}
