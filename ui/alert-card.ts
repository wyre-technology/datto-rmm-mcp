/**
 * Iframe bridge + renderer for the Datto RMM alert card (MCP Apps, SEP-1865).
 *
 * Runs inside the host's sandboxed iframe. Uses the official MCP Apps client
 * (`App`) to receive the tool result from the host and to call
 * datto_resolve_alert back (the "Resolve alert" round-trip).
 *
 * The server attaches a normalized `_card` payload to datto_get_alert results
 * (see src/alert-card.ts) so this renderer never needs to interpret raw alert
 * context objects itself.
 *
 * Rendering uses DOM construction (no innerHTML) — alert messages and device
 * hostnames are untrusted RMM data, so text only ever lands in text nodes.
 *
 * White-label: the card is neutral by default and applies an injected
 * `window.__BRAND__` override (set by the MCP server via MCP_BRAND_* env
 * vars or, eventually, the gateway per-org) so the same card can render in
 * any customer's brand. No injection = neutral card with no brand identity.
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface Brand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}
declare global {
  interface Window {
    __BRAND__?: Brand;
  }
}

/** Mirror of AlertCard in src/alert-card.ts — keep in sync. */
interface AlertCard {
  alertUid: string;
  title: string;
  message?: string;
  priority?: string;
  status?: string;
  device?: string;
  site?: string;
  category?: string;
  createdAt?: string;
  resolvedBy?: string;
  canResolve: boolean;
}

const brand: Brand = window.__BRAND__ ?? {};

// Apply any injected brand overrides onto the CSS custom properties.
function applyBrand(): void {
  const root = document.documentElement.style;
  if (brand.primaryColor) root.setProperty("--brand-primary", brand.primaryColor);
  if (brand.accentColor) root.setProperty("--brand-accent", brand.accentColor);
  if (brand.bg) root.setProperty("--brand-bg", brand.bg);
  if (brand.text) root.setProperty("--brand-text", brand.text);
}

const app = new App({ name: "Datto RMM Alert Card", version: "1.0.0" });
let current: AlertCard | null = null;

/** Create an element with a class and (safe, text-node) children. */
function el(
  tag: string,
  className = "",
  ...children: Array<Node | string | null>
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child == null) continue;
    node.append(child); // strings become text nodes — never parsed as HTML
  }
  return node;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function field(label: string, value: string | undefined, withDot = false): HTMLElement | null {
  if (!value) return null;
  const valueEl = el("div", withDot ? "field__value sla" : "field__value");
  if (withDot) valueEl.append(el("span", "dot"));
  valueEl.append(value);
  return el("div", "field", el("div", "field__label", label), valueEl);
}

function badge(text: string | undefined, cls: string): HTMLElement | null {
  return text ? el("span", `badge ${cls}`, text) : null;
}

function render(a: AlertCard): void {
  current = a;

  // Brand identity only renders when a brand was injected — the neutral
  // default card carries no identity at all.
  const brandId = el("span", "brandid");
  if (brand.logoUrl) {
    const logo = document.createElement("img");
    logo.src = brand.logoUrl;
    logo.alt = brand.name ?? "";
    logo.style.display = "inline-block";
    brandId.append(logo);
  }
  if (brand.name) brandId.append(el("span", "brand", brand.name));

  let messageSection: HTMLElement | null = null;
  if (a.message) {
    messageSection = el(
      "div",
      "message",
      el("div", "message__h", "Message"),
      el("div", "message__body", a.message),
    );
  }

  let actions: HTMLElement | null = null;
  if (a.canResolve) {
    const btn = el("button", "btn", "Resolve alert") as HTMLButtonElement;
    btn.id = "resolve-btn";
    btn.addEventListener("click", async () => {
      if (!current?.canResolve) return;
      btn.disabled = true;
      btn.textContent = "Resolving…";
      try {
        // The card already holds the alert UID — resolving is the one write
        // action this card exposes.
        await app.callServerTool({
          name: "datto_resolve_alert",
          arguments: { alertUid: current.alertUid },
        });
        current = { ...current, status: "Resolved", canResolve: false };
        render(current);
      } catch {
        btn.disabled = false;
        btn.textContent = "Resolve alert";
      }
    });
    actions = el("div", "actions", btn);
  }

  const body = el(
    "div",
    "card__body",
    el("div", "brandrow", brandId, el("span", "alertid", `${a.alertUid.slice(0, 8)} · Datto RMM`)),
    el("h1", "", a.title),
    el("div", "badges", badge(a.priority, "badge--prio"), badge(a.status, "badge--status")),
    el(
      "div",
      "grid",
      field("Device", a.device),
      field("Site", a.site, true),
      field("Category", a.category),
      field("Created", a.createdAt && fmtDate(a.createdAt)),
      field("Resolved by", a.resolvedBy),
    ),
    messageSection,
    actions,
  );

  const root = document.getElementById("root")!;
  root.replaceChildren(el("div", "card", el("div", "card__bar"), body));
}

// datto-rmm-mcp returns the alert JSON directly, with the normalized card
// attached as a top-level _card field.
function extractCard(obj: unknown): AlertCard | null {
  const card = (obj as { _card?: AlertCard })?._card;
  return card && typeof card.alertUid === "string" && card.title ? card : null;
}

applyBrand();

// Must be set before connect() so the initial tool-result isn't missed.
app.ontoolresult = (result: { content?: Array<{ type: string; text?: string }> }) => {
  const payload = (result.content ?? []).find((c) => c.type === "text");
  if (!payload?.text) return;
  try {
    const card = extractCard(JSON.parse(payload.text));
    if (card) render(card);
  } catch {
    /* ignore malformed payloads */
  }
};

app.connect();
