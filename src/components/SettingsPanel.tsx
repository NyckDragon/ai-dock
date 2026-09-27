import { ArrowDown, ArrowUp, Check, Eye, EyeOff, FolderOpen, Monitor as MonitorIcon, Power } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { intlLocale, t, tr } from "../lib/i18n";
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
      <div className="tabs" role="tablist" aria-label={t("Seções das configurações")}>
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
            {t(item.label)}
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
    <div className="mode-picker" role="radiogroup" aria-label={t("Visual do dock recolhido")}>
      {COMPACT_MODES.map((mode) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === mode.id}
          key={mode.id}
          className={value === mode.id ? "is-selected" : ""}
          onClick={() => onChange(mode.id)}
        >
          <strong>{t(mode.title)}</strong>
          <small>{t(mode.description)}</small>
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
      <Group title={t("Idioma")}>
        <Segmented
          label={t("Idioma")}
          value={settings.language}
          onChange={(language) => update({ language })}
          options={[
            { value: "auto", label: t("Automático") },
            { value: "pt", label: "Português" },
            { value: "en", label: "English" }
          ]}
        />
      </Group>

      <Group title={t("Tema")}>
        <Segmented
          label={t("Tema")}
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { value: "system", label: t("Sistema") },
            { value: "dark", label: t("Escuro") },
            { value: "light", label: t("Claro") }
          ]}
        />
      </Group>

      <Group title={t("Dock recolhido")}>
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

      <Group title={t("Em destaque")}>
        <Segmented
          label={t("Janela em destaque no dock")}
          value={settings.headline}
          onChange={(headline) => update({ headline })}
          options={[
            { value: "session", label: t("Sessão atual (5h)") },
            { value: "limiting", label: t("A que mais limita") }
          ]}
        />
        <p className="hint">
          {t(
            "Qual janela aparece no anel do dock e no número grande do card. Quem não tem sessão de 5h (como o Cursor) mostra a janela que tiver."
          )}
        </p>
      </Group>

      <Group title={t("Histórico no card")}>
        <Segmented
          label={t("Período do gráfico de histórico")}
          value={settings.historyRange}
          onChange={(historyRange) => update({ historyRange })}
          options={[
            { value: "24h", label: "24h" },
            { value: "7d", label: t("7 dias") },
            { value: "30d", label: t("30 dias") }
          ]}
        />
        <p className="hint">{t("O histórico fica só neste PC e começa a partir da primeira leitura.")}</p>
      </Group>

      <Group title={t("Percentual")}>
        <Segmented
          label={t("O que o percentual mostra")}
          value={settings.display}
          onChange={(display) => update({ display })}
          options={[
            { value: "native", label: t("Como no app") },
            { value: "remaining", label: t("Restante") },
            { value: "used", label: t("Usado") }
          ]}
        />
        <p className="hint">
          {t(
            "\"Como no app\" segue cada produto: o Claude mostra quanto você já usou, como no claude.ai; os outros mostram quanto resta."
          )}
        </p>
        {settings.compactMode !== "classic" ? (
          <Switch
            label={t("Símbolo % no dock")}
            description={t("Desligue para ganhar espaço com números de 3 dígitos.")}
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
      <Group title={t("Lado da tela")}>
        <Segmented
          label={t("Lado da tela")}
          value={settings.side}
          onChange={(side) => update({ side })}
          options={[
            { value: "left", label: t("Esquerda") },
            { value: "right", label: t("Direita") }
          ]}
        />
      </Group>

      <Group title={t("Altura")}>
        <div className="range-row">
          <input
            type="range"
            min={-45}
            max={45}
            step={1}
            value={settings.verticalOffset}
            aria-label={t("Posição vertical do dock")}
            aria-valuetext={
              settings.verticalOffset === 0
                ? t("Centro")
                : settings.verticalOffset < 0
                  ? t("{value}% acima", { value: Math.abs(settings.verticalOffset) })
                  : t("{value}% abaixo", { value: settings.verticalOffset })
            }
            onChange={(event) => update({ verticalOffset: Number(event.target.value) })}
          />
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => update({ verticalOffset: 0 })}
            disabled={settings.verticalOffset === 0}
          >
            {t("Centralizar")}
          </button>
        </div>
        <p className="hint">{t("Arraste para subir ou descer o dock na borda.")}</p>
      </Group>

      {monitors.length > 0 ? (
        <Group title={t("Tela")}>
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
                  <strong>{t("Tela {number}", { number: monitor.index + 1 })}</strong>
                  <small>
                    {tr(monitor.name)} · {monitor.width} × {monitor.height}
                  </small>
                </span>
                {monitor.index === settings.monitorIndex ? <Check size={15} /> : null}
              </button>
            ))}
          </div>
        </Group>
      ) : null}

      <Group title={t("Visibilidade")}>
        <Switch
          label={t("Ocultar automaticamente")}
          description={t("Fica só uma faixa fina na borda. Passe o mouse para mostrar.")}
          checked={settings.autoHide}
          onChange={(autoHide) => update({ autoHide })}
        />
        <Switch
          label={t("Esconder em tela cheia")}
          description={t("Some durante jogos, vídeos e apresentações.")}
          checked={settings.hideOnFullscreen}
          onChange={(hideOnFullscreen) => update({ hideOnFullscreen })}
        />
      </Group>
    </>
  );
}

const PAUSES: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1h" },
  { minutes: 120, label: "2h" },
  { minutes: 240, label: "4h" }
];

function tomorrowMorning(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0).getTime();
}

function PauseNotifications({ settings, update }: Pick<SettingsPanelProps, "settings" | "update">) {
  const until = settings.notificationsPausedUntil;
  if (until != null && until > Date.now()) {
    const time = new Intl.DateTimeFormat(intlLocale(), {
      weekday: new Date(until).toDateString() === new Date().toDateString() ? undefined : "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(until);
    return (
      <div className="notice notice--warning">
        <span>{t("Notificações pausadas até {time}.", { time })}</span>
        <button type="button" className="text-button" onClick={() => update({ notificationsPausedUntil: null })}>
          {t("Retomar")}
        </button>
      </div>
    );
  }
  return (
    <div className="pause-row">
      <span>{t("Pausar por")}</span>
      <div className="pause-row__options">
        {PAUSES.map((pause) => (
          <button
            type="button"
            key={pause.minutes}
            className="chip"
            onClick={() => update({ notificationsPausedUntil: Date.now() + pause.minutes * 60 * 1000 })}
          >
            {pause.label}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => update({ notificationsPausedUntil: tomorrowMorning() })}>
          {t("Até amanhã")}
        </button>
      </div>
    </div>
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
      <Group title={t("Comportamento")}>
        <Switch
          label={t("Iniciar com o Windows")}
          checked={Boolean(autostart)}
          disabled={autostart == null}
          onChange={onAutostart}
        />
        <Switch
          label={t("Atalho global")}
          description={
            <>
              <kbd>{t(GLOBAL_SHORTCUT_LABEL)}</kbd> {t("abre a busca de prompts de qualquer lugar.")}
            </>
          }
          checked={settings.globalShortcut}
          onChange={(globalShortcut) => update({ globalShortcut })}
        />
        {shortcutError ? <div className="notice notice--error">{shortcutError}</div> : null}
        <Switch
          label={t("Colar direto no app anterior")}
          description={t("Depois de copiar um prompt, o dock recolhe, volta para o app em que você estava e cola.")}
          checked={settings.autoPaste}
          onChange={(autoPaste) => update({ autoPaste })}
        />
        <Switch
          label={t("Fechar o painel ao clicar fora")}
          checked={settings.closeOnBlur}
          onChange={(closeOnBlur) => update({ closeOnBlur })}
        />
      </Group>

      <Group title={t("Atualizar uso a cada")}>
        <Segmented
          label={t("Intervalo de atualização")}
          value={settings.refreshMinutes}
          onChange={(refreshMinutes) => update({ refreshMinutes })}
          options={REFRESH_CHOICES.map((minutes) => ({ value: minutes, label: t("{minutes} min", { minutes }) }))}
        />
        <p className="hint">{t("Se um provider limitar a consulta, o intervalo dobra sozinho até voltar ao normal.")}</p>
      </Group>

      <Group title={t("Notificações")}>
        <Switch
          label={t("Quota baixa")}
          description={t("Avisa quando uma janela passa de 80% e de 95% de uso.")}
          checked={settings.notifyLowQuota}
          onChange={(notifyLowQuota) => update({ notifyLowQuota })}
        />
        <Switch
          label={t("Limite renovado")}
          description={t("Avisa quando uma janela de uso reseta.")}
          checked={settings.notifyReset}
          onChange={(notifyReset) => update({ notifyReset })}
        />
        <Switch
          label={t("Agente esperando você")}
          description={t("Codex, Cursor ou Antigravity pararam para pedir sua resposta.")}
          checked={settings.notifyWaiting}
          onChange={(notifyWaiting) => update({ notifyWaiting })}
        />
        <Switch
          label={t("Instabilidade no serviço")}
          description={t("Incidente na página de status oficial do Claude, Codex ou Cursor.")}
          checked={settings.notifyIncidents}
          onChange={(notifyIncidents) => update({ notifyIncidents })}
        />
        <Switch
          label={t("Falha ao atualizar")}
          description={t("Um provider falhou 3 vezes seguidas, e quando volta.")}
          checked={settings.notifyFailures}
          onChange={(notifyFailures) => update({ notifyFailures })}
        />
        <PauseNotifications settings={settings} update={update} />
        <button type="button" className="button button--ghost button--block" onClick={onTestNotification}>
          {t("Enviar notificação de teste")}
        </button>
      </Group>

      <Group title={t("Sobre")}>
        <p className="hint">
          AI Dock {version ? "v" + version : ""} · {t("quota das IAs e prompts do Obsidian.")}
        </p>
        <div className="button-row">
          <button type="button" className="button button--ghost" onClick={onReplayOnboarding}>
            {t("Rever introdução")}
          </button>
          <button type="button" className="button button--danger" onClick={onQuit}>
            <Power size={14} /> {t("Encerrar AI Dock")}
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
      <Group title={t("Providers")}>
        <p className="hint">{t("Ordem e visibilidade no dock e no painel.")}</p>
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
                    {provider ? (provider.connected ? t("Conectado") : tr(provider.error) || t("Não conectado")) : t("Lendo…")}
                  </small>
                </span>
                <span className="provider-list__actions">
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => move(id, -1)}
                    disabled={index === 0}
                    aria-label={t("Mover {name} para cima", { name })}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => move(id, 1)}
                    disabled={index === settings.providerOrder.length - 1}
                    aria-label={t("Mover {name} para baixo", { name })}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => toggle(id)}
                    aria-pressed={!hidden}
                    aria-label={hidden ? t("Mostrar {name}", { name }) : t("Ocultar {name}", { name })}
                    title={hidden ? t("Mostrar") : t("Ocultar")}
                  >
                    {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </Group>

      <Group title={t("Claude")}>
        <ClaudeConnectCard onChanged={onProvidersChanged} withDialog={withDialog} />
      </Group>

      <Group title={t("Obsidian")}>
        <button type="button" className="option" onClick={onChooseFolder}>
          <span className="tile-icon">
            <FolderOpen size={15} />
          </span>
          <span className="option__copy">
            <strong>{settings.obsidianPath ? t("Pasta conectada") : t("Conectar pasta")}</strong>
            <small>{settings.obsidianPath || t("Vault ou pasta de prompts")}</small>
          </span>
        </button>
        {settings.obsidianPath ? (
          <button type="button" className="text-button" onClick={() => update({ obsidianPath: null })}>
            {t("Desconectar pasta")}
          </button>
        ) : null}
        <p className="hint">
          {t("Use {simple} ou {fallback} no prompt para preencher antes de copiar.", { simple: "\u0000", fallback: "\u0001" })
            .split(/(\u0000|\u0001)/)
            .map((part, index) =>
              part === "\u0000" ? (
                <code key={index}>{"{{" + t("variável") + "}}"}</code>
              ) : part === "\u0001" ? (
                <code key={index}>{"{{" + t("variável") + "|" + t("padrão") + "}}"}</code>
              ) : (
                part
              )
            )}
        </p>
      </Group>
    </>
  );
}
