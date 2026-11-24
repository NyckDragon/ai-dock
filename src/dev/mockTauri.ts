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
    plan: "Max 5x",
    error: null,
    windows: [win("session", "Sessão · 5h", 13, 2.05), win("weekly", "Semanal", 62, 19.5)]
  },
  {
    id: "codex",
    name: "Codex",
    connected: true,
    plan: "plus",
    error: null,
    windows: [win("session", "Sessão · 5h", 11, 2.1), win("weekly", "Semanal", 86, 74)]
  },
  {
    id: "cursor",
    name: "Cursor",
    connected: true,
    plan: "X Premium",
    error: null,
    windows: [win("weekly", "Semanal", 34, 52)]
  },
  {
    id: "grok",
    name: "Grok",
    connected: false,
    plan: "X Premium",
    error: "A semana virou. Abra o Grok Bot para atualizar.",
    windows: [win("weekly", "Semanal", 76, -2)]
  },
  account("antigravity", "Antigravity · Conta 1 (Principal)", "conta1@example.com", 87, 100),
  account("antigravity-2", "Antigravity · Conta 2", "conta2@example.com", 72, 65),
  account("antigravity-3", "Antigravity · Conta 3", "conta3@example.com", 91, 84),
  account("antigravity-4", "Antigravity · Conta 4", "conta4@example.com", 12, 8),
  {
    id: "antigravity-openbot",
    name: "Antigravity · OpenBot",
    connected: true,
    plan: "Google AI Pro",
    email: "conta1@example.com",
    error: null,
    windows: [win("gemini-session", "Gemini · 5h", 87, 3)]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    connected: false,
    plan: null,
    error: "DeepSeek Harness não encontrado neste PC.",
    windows: []
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
      confidence: "inferred",
      sessions: [
        { id: "c1", title: "ATI · Antigravity Contas - Login Preso por Conta · Correção #1", detail: "Usando Bash", state: "working", since: Date.now() - 20_000 },
        { id: "c2", title: "ATI · Sistema Medina da Rocha · Criação #3", detail: "Executando tarefa", state: "working", since: Date.now() - 70_000 }
      ]
    },
    {
      providerId: "codex",
      state: "working",
      confidence: "high",
      sessions: [
        { id: "x1", title: "Agent Pauli", detail: "Executando tarefa", state: "working", since: Date.now() - 10_000 },
        { id: "x2", title: "Agent Averroes", detail: "Executando tarefa", state: "working", since: Date.now() - 60_000 },
        { id: "x3", title: "Agent Pasteur", detail: "Executando tarefa", state: "working", since: Date.now() - 120_000 },
        { id: "x4", title: "Agent Curie", detail: "Executando tarefa", state: "working", since: Date.now() - 180_000 }
      ]
    }
  ],

  get_provider_status: () => [],
  get_monitors: () => [
    { index: 0, name: "\\\\.\\DISPLAY1", width: 1920, height: 1080, scaleFactor: 1 },
    { index: 1, name: "\\\\.\\DISPLAY3", width: 3440, height: 1440, scaleFactor: 1 },
    { index: 2, name: "\\\\.\\DISPLAY4", width: 2360, height: 1640, scaleFactor: 1.5 }
  ],
  get_local_costs: () => ({ entries: demoCosts(), prices: "online", files: 42 }),
  provider_setup_status: () => ({ installed: true, authenticated: true, version: "demo", npmAvailable: true }),
  claude_web_status: () => usage[0],
  scan_obsidian_prompts: () => [
    { path: "Prompts/Revisar PR.md", title: "Revisar PR com foco em bugs", category: "Código", tags: ["review", "git"], favorite: true, content: "Revise o diff de {{branch}} procurando bugs reais..." },
    { path: "Prompts/Legenda Reels.md", title: "Legenda de Reels sem cara de IA", category: "Conteúdo", tags: ["instagram"], favorite: true, content: "Escreva a legenda do Reels sobre {{tema}}..." },
    { path: "Prompts/Handoff.md", title: "Handoff de conversa longa", category: "Organização", tags: ["handoff"], favorite: false, content: "Resuma o estado atual do projeto {{projeto|AI Dock}}..." },
    { path: "Prompts/Landing.md", title: "Landing page com referências reais", category: "Design", tags: ["site", "design"], favorite: false, content: "Monte a landing de {{cliente}} a partir das referências..." },
    { path: "Prompts/Carrossel.md", title: "Carrossel de 7 slides", category: "Conteúdo", tags: ["instagram", "carrossel"], favorite: false, content: "Crie um carrossel sobre {{tema}} com gancho no slide 1..." }
  ]
};

/** The demo starts with the same choices as the real dock: names, glass, three monitors. */
function seedDemoSettings() {
  const key = "ai-dock-settings";
  const current = JSON.parse(localStorage.getItem(key) || "{}");
  if (current.demoSeeded) return;
  localStorage.setItem(
    key,
    JSON.stringify({
      ...current,
      demoSeeded: true,
      onboarded: true,
      glassEnabled: true,
      glassOpacity: 10,
      monitorIndex: 1,
      obsidianPath: "D:\\Obsidian\\Prompts",
      providerAliases: { antigravity: "Nyco", "antigravity-2": "Nyck", "antigravity-3": "Jessy", "antigravity-4": "Juba" }
    })
  );
}

export function installDemoBridge() {
  seedDemoSettings();
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
