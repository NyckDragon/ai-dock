import { ArrowDown, ArrowUp, Check, Eye, EyeOff, FolderOpen, Monitor as MonitorIcon, Power } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { compactSlots } from "../lib/quota";
import { GLOBAL_SHORTCUT_LABEL, REFRESH_CHOICES } from "../lib/settings";
import type {
  CompactMode,
  MonitorInfo,
  ProviderActivity,
  ProviderUsage,
  Settings,
  SettingsTab
} from "../types";
import { ClaudeConnectCard } from "./ClaudeConnectCard";
import { Segmented, Switch } from "./controls";
import { DockPill } from "./DockPill";
import { ProviderIcon } from "./ProviderIcon";

export const COMPACT_MODES: { id: CompactMode; title: string; description: string }[] = [
  { id: "ring", title: "Círculo", description: "Anel de quota + %" },
  { id: "square", title: "Quadrado", description: "Borda de quota + %" },
  { id: "percent", title: "Números", description: "Ícone + % colorido" },
  { id: "classic", title: "Clássico", description: "Ícone + ponto de status" }
];

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "appearance", label: "Aparência" },
  { id: "position", label: "Posição" },
  { id: "general", label: "Geral" },
  { id: "connections", label: "Conexões" }
];

const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  antigravity: "Antigravity"
};

export type SettingsPanelProps = {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  providers: ProviderUsage[];
  activities: ProviderActivity[];
  monitors: MonitorInfo[];
  autostart: boolean | null;
  onAutostart: (next: boolean) => void;
  shortcutError: string | null;
  version: string | null;
  onChooseFolder: () => void;
  onProvidersChanged: () => void;
  onTestNotification: () => void;
  onReplayOnboarding: () => void;
  onQuit: () => void;
  withDialog: <T>(run: () => Promise<T> | T) => Promise<T>;
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3 className="settings-label">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { tab, onTab } = props;
  return (
    <div className="settings">
      <div className="tabs" role="tablist" aria-label="Seções das configurações">
        {TABS.map((item) => (
          <button
            type="button"
            role="tab"
            key={item.id}
            id={"settings-tab-" + item.id}
            aria-selected={tab === item.id}
            aria-controls="settings-tabpanel"
            className={tab === item.id ? "is-selected" : ""}
            onClick={() => onTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="panel-scroll" role="tabpanel" id="settings-tabpanel" aria-labelledby={"settings-tab-" + tab}>
        {tab === "appearance" ? <AppearanceTab {...props} /> : null}
        {tab === "position" ? <PositionTab {...props} /> : null}
        {tab === "general" ? <GeneralTab {...props} /> : null}
        {tab === "connections" ? <ConnectionsTab {...props} /> : null}
      </div>
    </div>
  );
}

export function CompactModePicker({ value, onChange }: { value: CompactMode; onChange: (mode: CompactMode) => void }) {
  return (
    <div className="mode-picker" role="radiogroup" aria-label="Visual do dock recolhido">
      {COMPACT_MODES.map((mode) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === mode.id}
          key={mode.id}
          className={value === mode.id ? "is-selected" : ""}
          onClick={() => onChange(mode.id)}
        >
          <strong>{mode.title}</strong>
          <small>{mode.description}</small>
        </button>
      ))}
    </div>
  );
}

function AppearanceTab({ settings, update, providers, activities }: SettingsPanelProps) {
  const previewSlots = useMemo(() => {
    const slots = compactSlots(providers).slice(0, 3);
    if (slots.length) return slots;
    return [
      { id: "claude", name: "Claude", connected: true, windows: [{ id: "s", label: "Sessão", remainingPercent: 72 }] },
      { id: "codex", name: "Codex", connected: true, windows: [{ id: "s", label: "Sessão", remainingPercent: 41 }] },
      { id: "cursor", name: "Cursor", connected: true, windows: [{ id: "s", label: "Sessão", remainingPercent: 12 }] }
    ];
  }, [providers]);

  return (
    <>
      <Group title="Tema">
        <Segmented
          label="Tema"
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { value: "system", label: "Sistema" },
            { value: "dark", label: "Escuro" },
            { value: "light", label: "Claro" }
          ]}
        />
      </Group>

      <Group title="Dock recolhido">
        <div className="mode-preview-layout">
          <div className="mode-preview" aria-hidden="true">
            <DockPill
              slots={previewSlots}
              mode={settings.compactMode}
              showSign={settings.showSign}
              display={settings.display}
              headline={settings.headline}
              activities={activities}
              side={settings.side}
              loading={false}
              interactive={false}
            />
          </div>
          <CompactModePicker value={settings.compactMode} onChange={(compactMode) => update({ compactMode })} />
        </div>
      </Group>

      <Group title="Em destaque">
        <Segmented
          label="Janela em destaque no dock"
          value={settings.headline}
          onChange={(headline) => update({ headline })}
          options={[
            { value: "session", label: "Sessão atual (5h)" },
            { value: "limiting", label: "A que mais limita" }
          ]}
        />
        <p className="hint">
          Qual janela aparece no anel do dock e no número grande do card. Quem não tem sessão de 5h (como o Cursor)
          mostra a janela que tiver.
        </p>
      </Group>

      <Group title="Percentual">
        <Segmented
          label="O que o percentual mostra"
          value={settings.display}
          onChange={(display) => update({ display })}
          options={[
            { value: "native", label: "Como no app" },
            { value: "remaining", label: "Restante" },
            { value: "used", label: "Usado" }
          ]}
        />
        <p className="hint">
          "Como no app" segue cada produto: o Claude mostra quanto você já usou, como no claude.ai; os outros mostram
          quanto resta.
        </p>
        {settings.compactMode !== "classic" ? (
          <Switch
            label="Símbolo % no dock"
            description="Desligue para ganhar espaço com números de 3 dígitos."
            checked={settings.showSign}
            onChange={(showSign) => update({ showSign })}
          />
        ) : null}
      </Group>
    </>
  );
}

function PositionTab({ settings, update, monitors }: SettingsPanelProps) {
  return (
    <>
      <Group title="Lado da tela">
        <Segmented
          label="Lado da tela"
          value={settings.side}
          onChange={(side) => update({ side })}
          options={[
            { value: "left", label: "Esquerda" },
            { value: "right", label: "Direita" }
          ]}
        />
      </Group>

      <Group title="Altura">
        <div className="range-row">
          <input
            type="range"
            min={-45}
            max={45}
            step={1}
            value={settings.verticalOffset}
            aria-label="Posição vertical do dock"
            aria-valuetext={
              settings.verticalOffset === 0
                ? "Centro"
                : Math.abs(settings.verticalOffset) + "% " + (settings.verticalOffset < 0 ? "acima" : "abaixo")
            }
            onChange={(event) => update({ verticalOffset: Number(event.target.value) })}
          />
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => update({ verticalOffset: 0 })}
            disabled={settings.verticalOffset === 0}
          >
            Centralizar
          </button>
        </div>
        <p className="hint">Arraste para subir ou descer o dock na borda.</p>
      </Group>

      {monitors.length > 0 ? (
        <Group title="Tela">
          <div className="option-list">
            {monitors.map((monitor) => (
              <button
                type="button"
                key={monitor.index}
                className={"option" + (monitor.index === settings.monitorIndex ? " is-selected" : "")}
                aria-pressed={monitor.index === settings.monitorIndex}
                onClick={() => update({ monitorIndex: monitor.index })}
              >
                <span className="tile-icon">
                  <MonitorIcon size={15} />
                </span>
                <span className="option__copy">
                  <strong>Tela {monitor.index + 1}</strong>
                  <small>
                    {monitor.name} · {monitor.width} × {monitor.height}
                  </small>
                </span>
                {monitor.index === settings.monitorIndex ? <Check size={15} /> : null}
              </button>
            ))}
          </div>
        </Group>
      ) : null}

      <Group title="Visibilidade">
        <Switch
          label="Ocultar automaticamente"
          description="Fica só uma faixa fina na borda. Passe o mouse para mostrar."
          checked={settings.autoHide}
          onChange={(autoHide) => update({ autoHide })}
        />
        <Switch
          label="Esconder em tela cheia"
          description="Some durante jogos, vídeos e apresentações."
          checked={settings.hideOnFullscreen}
          onChange={(hideOnFullscreen) => update({ hideOnFullscreen })}
        />
      </Group>
    </>
  );
}

function GeneralTab({
  settings,
  update,
  autostart,
  onAutostart,
  shortcutError,
  version,
  onTestNotification,
  onReplayOnboarding,
  onQuit
}: SettingsPanelProps) {
  return (
    <>
      <Group title="Comportamento">
        <Switch
          label="Iniciar com o Windows"
          checked={Boolean(autostart)}
          disabled={autostart == null}
          onChange={onAutostart}
        />
        <Switch
          label="Atalho global"
          description={
            <>
              <kbd>{GLOBAL_SHORTCUT_LABEL}</kbd> abre a busca de prompts de qualquer lugar.
            </>
          }
          checked={settings.globalShortcut}
          onChange={(globalShortcut) => update({ globalShortcut })}
        />
        {shortcutError ? <div className="notice notice--error">{shortcutError}</div> : null}
        <Switch
          label="Colar direto no app anterior"
          description="Depois de copiar um prompt, o dock recolhe, volta para o app em que você estava e cola."
          checked={settings.autoPaste}
          onChange={(autoPaste) => update({ autoPaste })}
        />
        <Switch
          label="Fechar o painel ao clicar fora"
          checked={settings.closeOnBlur}
          onChange={(closeOnBlur) => update({ closeOnBlur })}
        />
      </Group>

      <Group title="Atualizar uso a cada">
        <Segmented
          label="Intervalo de atualização"
          value={settings.refreshMinutes}
          onChange={(refreshMinutes) => update({ refreshMinutes })}
          options={REFRESH_CHOICES.map((minutes) => ({ value: minutes, label: minutes + " min" }))}
        />
        <p className="hint">Se um provider limitar a consulta, o intervalo dobra sozinho até voltar ao normal.</p>
      </Group>

      <Group title="Notificações">
        <Switch
          label="Quota baixa"
          description="Avisa quando uma janela passa de 80% e de 95% de uso."
          checked={settings.notifyLowQuota}
          onChange={(notifyLowQuota) => update({ notifyLowQuota })}
        />
        <Switch
          label="Limite renovado"
          description="Avisa quando uma janela de uso reseta."
          checked={settings.notifyReset}
          onChange={(notifyReset) => update({ notifyReset })}
        />
        <Switch
          label="Agente esperando você"
          description="Codex, Cursor ou Antigravity pararam para pedir sua resposta."
          checked={settings.notifyWaiting}
          onChange={(notifyWaiting) => update({ notifyWaiting })}
        />
        <button type="button" className="button button--ghost button--block" onClick={onTestNotification}>
          Enviar notificação de teste
        </button>
      </Group>

      <Group title="Sobre">
        <p className="hint">AI Dock {version ? "v" + version : ""} · quota das IAs e prompts do Obsidian.</p>
        <div className="button-row">
          <button type="button" className="button button--ghost" onClick={onReplayOnboarding}>
            Rever introdução
          </button>
          <button type="button" className="button button--danger" onClick={onQuit}>
            <Power size={14} /> Encerrar AI Dock
          </button>
        </div>
      </Group>
    </>
  );
}

function ConnectionsTab({
  settings,
  update,
  providers,
  onChooseFolder,
  onProvidersChanged,
  withDialog
}: SettingsPanelProps) {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  function move(id: string, direction: -1 | 1) {
    const order = [...settings.providerOrder];
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    update({ providerOrder: order });
  }

  function toggle(id: string) {
    const hidden = settings.hiddenProviders.includes(id);
    update({
      hiddenProviders: hidden
        ? settings.hiddenProviders.filter((item) => item !== id)
        : [...settings.hiddenProviders, id]
    });
  }

  return (
    <>
      <Group title="Providers">
        <p className="hint">Ordem e visibilidade no dock e no painel.</p>
        <ul className="provider-list">
          {settings.providerOrder.map((id, index) => {
            const provider = byId.get(id);
            const hidden = settings.hiddenProviders.includes(id);
            const name = provider?.name || PROVIDER_NAMES[id] || id;
            return (
              <li key={id} className={"provider-list__item" + (hidden ? " is-hidden" : "")}>
                <ProviderIcon providerId={id} size={16} brand />
                <span className="provider-list__copy">
                  <strong>{name}</strong>
                  <small className={provider?.connected ? "is-on" : ""}>
                    {provider ? (provider.connected ? "Conectado" : provider.error || "Não conectado") : "Lendo…"}
                  </small>
                </span>
                <span className="provider-list__actions">
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => move(id, -1)}
                    disabled={index === 0}
                    aria-label={"Mover " + name + " para cima"}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => move(id, 1)}
                    disabled={index === settings.providerOrder.length - 1}
                    aria-label={"Mover " + name + " para baixo"}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => toggle(id)}
                    aria-pressed={!hidden}
                    aria-label={(hidden ? "Mostrar " : "Ocultar ") + name}
                    title={hidden ? "Mostrar" : "Ocultar"}
                  >
                    {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </Group>

      <Group title="Claude">
        <ClaudeConnectCard onChanged={onProvidersChanged} withDialog={withDialog} />
      </Group>

      <Group title="Obsidian">
        <button type="button" className="option" onClick={onChooseFolder}>
          <span className="tile-icon">
            <FolderOpen size={15} />
          </span>
          <span className="option__copy">
            <strong>{settings.obsidianPath ? "Pasta conectada" : "Conectar pasta"}</strong>
            <small>{settings.obsidianPath || "Vault ou pasta de prompts"}</small>
          </span>
        </button>
        {settings.obsidianPath ? (
          <button type="button" className="text-button" onClick={() => update({ obsidianPath: null })}>
            Desconectar pasta
          </button>
        ) : null}
        <p className="hint">
          Use <code>{"{{variável}}"}</code> ou <code>{"{{variável|padrão}}"}</code> no prompt para preencher antes de copiar.
        </p>
      </Group>
    </>
  );
}
