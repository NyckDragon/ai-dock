/**
 * Dev-only check of the interface standard
 * (Documents/00_Organizacao/01_Padroes/08_Padrao_de_Interface_UI.md).
 * Open http://localhost:1420/?demo&audit: every second it measures the screen
 * on view, outlines each problem in red and lists them in window.__uiAudit.
 */

type Finding = { rule: string; detail: string; el: Element };

const ROW_SELECTOR = ".setting-row, .select-setting-row, .mascot-row, .range-row, .pause-row";
const CONTROL_SELECTOR = ".switch, .select-wrapper, .mascot-choice, .button, .segmented, input[type='range']";
const SURFACE_SELECTOR = ".settings-card, .usage-card, .accounts, .cost-table, .cost-hero, .cost-chart, .provider-peek";

const center = (rect: DOMRect) => rect.top + rect.height / 2;

function visible(el: Element) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(el).opacity !== "0" && !el.closest(".quota-tip");
}

function hasFill(el: Element) {
  const style = getComputedStyle(el);
  const bg = style.backgroundColor;
  const alpha = bg.startsWith("rgba") ? Number(bg.split(",")[3]?.replace(")", "")) : bg === "transparent" ? 0 : 1;
  return alpha > 0.02 || style.backgroundImage !== "none";
}

function audit(): Finding[] {
  const findings: Finding[] = [];

  // 2.1 Control centered with the whole text block next to it.
  document.querySelectorAll(ROW_SELECTOR).forEach((row) => {
    if (!visible(row)) return;
    const copy = row.querySelector("[class$='__copy'], .setting-row__copy, .select-setting-row__copy");
    const controls = [...row.querySelectorAll(CONTROL_SELECTOR)].filter(
      (control) => control.closest(ROW_SELECTOR) === row && !control.closest(".segmented") === !control.matches(".segmented") && visible(control)
    );
    if (!copy) return;
    const copyCenter = center(copy.getBoundingClientRect());
    controls.forEach((control) => {
      const delta = Math.abs(center(control.getBoundingClientRect()) - copyCenter);
      if (delta > 2) findings.push({ rule: "2.1 controle desalinhado", detail: `${delta.toFixed(1)} px fora do centro do texto`, el: control });
    });
  });

  // 2.2 Text centered inside buttons, chips and tabs.
  document.querySelectorAll("button, [role='tab']").forEach((button) => {
    if (!visible(button) || button.closest(".pill-slot, .dock-pill, .accounts__item, .panel-nav__item, .usage-card, .option, .mode-picker")) return;
    if (button.querySelector("[class*='__copy'], small") || button.getBoundingClientRect().height > 48) return; // multi-line row, not a label button
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.textContent?.trim() ? 1 : 3) });
    const first = walker.nextNode();
    if (!first) return;
    let last: Node = first;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node;
    const range = document.createRange();
    range.setStartBefore(button.querySelector("svg, .provider-chip, img") ?? first);
    range.setEndAfter(last);
    const textRect = range.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const dy = Math.abs(center(textRect) - center(rect));
    const dx = Math.abs(textRect.left + textRect.width / 2 - (rect.left + rect.width / 2));
    if (dy > 1.5) findings.push({ rule: "2.2 texto fora do centro (vertical)", detail: `${dy.toFixed(1)} px`, el: button });
    if (dx > 2 && getComputedStyle(button).textAlign !== "left") findings.push({ rule: "2.2 texto fora do centro (horizontal)", detail: `${dx.toFixed(1)} px`, el: button });
  });

  // 1.2 Nothing touches the top or bottom of a card.
  document.querySelectorAll(SURFACE_SELECTOR).forEach((card) => {
    if (!visible(card)) return;
    const rect = card.getBoundingClientRect();
    [...card.children].forEach((child) => {
      if (!visible(child)) return;
      const r = child.getBoundingClientRect();
      if (r.top - rect.top < 8 && hasFill(child)) findings.push({ rule: "1.2 colado no topo do cartão", detail: `${(r.top - rect.top).toFixed(1)} px`, el: child });
      if (rect.bottom - r.bottom < 8 && hasFill(child)) findings.push({ rule: "1.2 colado na base do cartão", detail: `${(rect.bottom - r.bottom).toFixed(1)} px`, el: child });
    });
  });

  // 3.1 No card inside a card.
  document.querySelectorAll(SURFACE_SELECTOR).forEach((card) => {
    card.querySelectorAll("*").forEach((inner) => {
      if (!visible(inner) || inner.matches("input, textarea, select, .select-input, .switch, .switch *, .segmented, .segmented *, .quota-track, .quota-track *, .accounts__track, .accounts__track *, .notice, .provider-chip, .tile-icon, .slot-chip, i, b, code, .health-chip *, .status-dot, .button, .icon-button, .accounts__best, .accounts__item, .dock-pill, .dock-pill *, .signal-legend *, .is-selected, .mode-preview, .mode-preview *")) return;
      const style = getComputedStyle(inner);
      const radius = parseFloat(style.borderTopLeftRadius);
      const rect = inner.getBoundingClientRect();
      if (hasFill(inner) && radius >= 8 && rect.width > 120 && rect.height > 40) {
        findings.push({ rule: "3.1 cartão dentro de cartão", detail: inner.className.toString(), el: inner });
      }
    });
  });

  // 4.1 Status and meta lines do not wrap.
  document.querySelectorAll(".usage-card__status, .brand-status, .provider-peek__brand small, .health-chip span").forEach((line) => {
    if (!visible(line)) return;
    const lineHeight = parseFloat(getComputedStyle(line).lineHeight) || 16;
    if (line.getBoundingClientRect().height > lineHeight * 1.5) findings.push({ rule: "4.1 linha de status quebrou", detail: line.textContent?.trim() ?? "", el: line });
  });

  // 6.1 Switch knob centered in its track.
  document.querySelectorAll(".switch").forEach((track) => {
    const knob = track.querySelector("i");
    if (!knob || !visible(track)) return;
    const delta = Math.abs(center(knob.getBoundingClientRect()) - center(track.getBoundingClientRect()));
    if (delta > 0.75) findings.push({ rule: "6.1 bolinha da chave fora do centro", detail: `${delta.toFixed(1)} px`, el: track });
  });

  // 1.3 / 1.4 Inside a card: no divider above buttons, no oversized gap between blocks.
  document.querySelectorAll(".settings-card").forEach((card) => {
    if (!visible(card)) return;
    const kids = [...card.children].filter(visible);
    kids.forEach((kid, index) => {
      const style = getComputedStyle(kid);
      const hasLine =
        parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none" && parseFloat(style.borderLeftWidth) === 0;
      if (hasLine && (kid.matches(".button, .button-row, .range-row, .option-list, .segmented") || kid.querySelector(":scope > .button"))) {
        findings.push({ rule: "1.3 divisória em cima de botão ou controle", detail: kid.className.toString(), el: kid });
      }
      const prev = kids[index - 1];
      if (!prev) return;
      // Measure what is drawn (text and controls), not the boxes and their padding.
      // Text to text: the first line of text of a block and the last line of the one above.
      const textRects = (el: Element) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => (node.textContent?.trim() && node.parentElement && visible(node.parentElement) ? 1 : 3)
        });
        const rects: DOMRect[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          if (rect.height > 0) rects.push(rect);
        }
        // Boxes (filled or bordered) count by their own edges.
        [el, ...el.querySelectorAll("*")].forEach((node) => {
          if (!visible(node)) return;
          const style = getComputedStyle(node);
          if (hasFill(node) || (parseFloat(style.borderTopWidth) > 0 && parseFloat(style.borderLeftWidth) > 0)) {
            rects.push(node.getBoundingClientRect());
          }
        });
        return rects;
      };
      const prevRects = textRects(prev);
      const nextRects = textRects(kid);
      if (!prevRects.length || !nextRects.length) return;
      const prevText = Math.max(...prevRects.map((rect) => rect.bottom));
      const nextTop = Math.min(...nextRects.map((rect) => rect.top));
      const gap = nextTop - prevText;
      if (gap > 40) findings.push({ rule: "1.4 vão grande entre blocos", detail: `${gap.toFixed(0)} px`, el: kid });
    });
  });

  // 3.3 Same component, same radius and height.
  const groups = new Map<string, Set<string>>();
  document.querySelectorAll(".button, .icon-button").forEach((el) => {
    if (!visible(el)) return;
    const small = el.classList.contains("icon-button--small") || el.classList.contains("button--small");
    const key = (el.classList.contains("icon-button") ? "icon-button" : "button") + (small ? "--small" : "");
    const style = getComputedStyle(el);
    const sig = style.borderTopLeftRadius + "/" + Math.round(el.getBoundingClientRect().height);
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key)!.add(sig);
  });
  groups.forEach((sigs, key) => {
    if (sigs.size > 1) findings.push({ rule: "3.3 mesmo componente com raio/altura diferentes", detail: `${key}: ${[...sigs].join(", ")}`, el: document.body });
  });

  return findings;
}

export function installUiAudit() {
  const style = document.createElement("style");
  style.textContent = "[data-ui-audit]{outline:2px solid #ff3b5c !important; outline-offset:1px}";
  document.head.appendChild(style);
  const run = () => {
    document.querySelectorAll("[data-ui-audit]").forEach((el) => el.removeAttribute("data-ui-audit"));
    const findings = audit();
    findings.forEach((finding) => finding.el !== document.body && finding.el.setAttribute("data-ui-audit", finding.rule));
    (window as unknown as Record<string, unknown>).__uiAudit = findings.map(({ rule, detail, el }) => ({
      rule,
      detail,
      where: (el as HTMLElement).className?.toString().slice(0, 60) || el.tagName
    }));
  };
  window.setInterval(run, 1000);
}
