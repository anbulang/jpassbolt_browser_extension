/**
 * In-page UI for the autofill content script, rendered inside a CLOSED Shadow
 * DOM so the host page can neither style it nor read it. Three surfaces:
 *
 *   - CTA: a small JP badge pinned inside a login field, with a suggestion count.
 *   - Menu: a dropdown of suggested credentials + generate-password + open-vault.
 *   - Banner: the post-login "Save this password?" prompt (autosave).
 *
 * SECURITY: no password is ever rendered here. Picking a credential asks the
 * background to REVEAL it and the result is written straight into the page
 * fields; the menu only ever shows non-secret names/usernames.
 */
import { rpc, type VaultItem } from '../shared/messages';
import { fill, setValue, passwordFields } from './dom';
import { generatePassword, DEFAULT_PASSWORD_OPTIONS } from '../shared/passgen';

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.cta {
  position: fixed; z-index: 2147483646; width: 22px; height: 22px; border-radius: 6px;
  border: none; cursor: pointer; display: grid; place-items: center;
  background: #4263eb; color: #fff; font-size: 10px; font-weight: 700;
  box-shadow: 0 1px 3px rgba(0,0,0,.25); padding: 0; line-height: 1;
}
.cta .badge {
  position: absolute; top: -6px; right: -6px; min-width: 15px; height: 15px; padding: 0 3px;
  border-radius: 999px; background: #e8590c; color: #fff; font-size: 9px; font-weight: 700;
  display: grid; place-items: center; border: 1.5px solid #fff;
}
.panel {
  position: fixed; z-index: 2147483647; background: #fff; color: #1f2937;
  border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.18);
  overflow: hidden; min-width: 248px; max-width: 340px;
}
.menu-head { padding: 9px 12px; font-size: 11px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #f0f0f3; letter-spacing: .02em; }
.row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; cursor: pointer; border: none; width: 100%; background: none; text-align: left; }
.row:hover { background: #f4f5fb; }
.ic { width: 30px; height: 30px; flex: none; border-radius: 9px; display: grid; place-items: center; background: #edf0fe; color: #3b4fd1; font-weight: 600; font-size: 13px; }
.row .m { min-width: 0; flex: 1; }
.row .n { font-size: 13px; font-weight: 500; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .s { font-size: 12px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sep { height: 1px; background: #f0f0f3; }
.empty { padding: 12px; font-size: 12px; color: #9ca3af; text-align: center; }
.action { color: #3b4fd1; font-weight: 500; font-size: 13px; }
/* autosave banner */
.banner { position: fixed; top: 16px; right: 16px; z-index: 2147483647; width: 320px;
  background: #fff; color: #1f2937; border: 1px solid #e5e7eb; border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,.2); padding: 14px; }
.banner .t { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13.5px; margin-bottom: 4px; }
.banner .logo { width: 22px; height: 22px; border-radius: 6px; background: #4263eb; color: #fff; display: grid; place-items: center; font-size: 10px; font-weight: 700; }
.banner .d { font-size: 12.5px; color: #6b7280; line-height: 1.45; margin-bottom: 12px; word-break: break-all; }
.banner .btns { display: flex; gap: 8px; }
.btn { flex: 1; height: 34px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid #e5e7eb; background: #f7f7f9; color: #374151; }
.btn:hover { background: #eef0f4; }
.btn.primary { background: #4263eb; border-color: #4263eb; color: #fff; }
.btn.primary:hover { background: #3b4fd1; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function hostOf(u: string): string {
  try { return new URL(u.includes('://') ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return u; }
}

export class InForm {
  private host: HTMLDivElement;
  private root: ShadowRoot;
  private cta: HTMLButtonElement | null = null;
  private anchor: HTMLInputElement | null = null;
  private panel: HTMLDivElement | null = null;
  private banner: HTMLDivElement | null = null;
  private rafPending = false;
  private readonly reposition = () => {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => { this.rafPending = false; this.place(); });
  };

  constructor() {
    this.host = el('div');
    this.host.style.cssText = 'all: initial;';
    // Closed mode: page scripts get null from host.shadowRoot.
    this.root = this.host.attachShadow({ mode: 'closed' });
    const style = el('style');
    style.textContent = STYLE;
    this.root.appendChild(style);
    (document.documentElement || document.body).appendChild(this.host);

    window.addEventListener('scroll', this.reposition, true);
    window.addEventListener('resize', this.reposition, true);
    document.addEventListener('click', this.onDocClick, true);
    document.addEventListener('keydown', this.onKey, true);
  }

  // ---- CTA ---------------------------------------------------------------
  showCta(anchor: HTMLInputElement, count: number): void {
    this.anchor = anchor;
    if (!this.cta) {
      this.cta = el('button', 'cta', 'JP');
      this.cta.title = 'JPassbolt';
      this.cta.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); void this.openMenu(); });
      this.root.appendChild(this.cta);
    }
    this.cta.querySelector('.badge')?.remove();
    if (count > 0) {
      const b = el('span', 'badge', count > 9 ? '9+' : String(count));
      this.cta.appendChild(b);
    }
    this.cta.style.display = 'grid';
    this.place();
  }

  hideCta(): void {
    // Hides only the badge — never the open menu (the focusout timer must not
    // tear down a menu the user just opened). Menu dismissal is handled by
    // outside-click / Esc / selection / navigation.
    if (this.cta) this.cta.style.display = 'none';
  }

  isMenuOpen(): boolean {
    return !!this.panel;
  }

  private place(): void {
    if (this.cta && this.cta.style.display !== 'none' && this.anchor) {
      const r = this.anchor.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { this.hideCta(); return; }
      this.cta.style.top = `${r.top + (r.height - 22) / 2}px`;
      this.cta.style.left = `${r.right - 28}px`;
    }
    if (this.panel && this.anchor) {
      const r = this.anchor.getBoundingClientRect();
      this.panel.style.top = `${r.bottom + 6}px`;
      this.panel.style.left = `${r.left}px`;
      this.panel.style.minWidth = `${Math.max(r.width, 248)}px`;
    }
  }

  // ---- menu --------------------------------------------------------------
  private async openMenu(): Promise<void> {
    if (this.panel) { this.closeMenu(); return; }
    let items: VaultItem[] = [];
    try { items = (await rpc({ type: 'FIND_FOR_URL', url: location.href })).items; } catch { /* show actions only */ }

    const panel = el('div', 'panel');
    panel.appendChild(el('div', 'menu-head', items.length ? 'Suggested logins' : 'JPassbolt'));

    if (items.length === 0) {
      panel.appendChild(el('div', 'empty', 'No saved logins for this site.'));
    } else {
      for (const it of items) {
        const row = el('button', 'row');
        const ic = el('div', 'ic', (it.name.trim()[0] || '?').toUpperCase());
        const m = el('div', 'm');
        m.appendChild(el('div', 'n', it.name));
        m.appendChild(el('div', 's', it.username || hostOf(it.uri) || '—'));
        row.append(ic, m);
        row.addEventListener('click', () => void this.useCredential(it.id));
        panel.appendChild(row);
      }
    }

    panel.appendChild(el('div', 'sep'));
    const gen = el('button', 'row');
    gen.appendChild(el('div', 'action', '⚄  Generate password'));
    gen.addEventListener('click', () => this.generateIntoPage());
    panel.appendChild(gen);

    const open = el('button', 'row');
    open.appendChild(el('div', 'action', '↗  Open JPassbolt'));
    open.addEventListener('click', () => { window.open(chrome.runtime.getURL('app.html'), '_blank'); this.closeMenu(); });
    panel.appendChild(open);

    this.panel = panel;
    this.root.appendChild(panel);
    this.place();
  }

  closeMenu(): void {
    this.panel?.remove();
    this.panel = null;
  }

  private async useCredential(id: string): Promise<void> {
    try {
      const { item, secret } = await rpc({ type: 'REVEAL', id });
      fill(item.username, secret.password);
    } catch { /* locked or denied — leave the form untouched */ }
    this.closeMenu();
    this.hideCta();
  }

  private generateIntoPage(): void {
    const pw = generatePassword(DEFAULT_PASSWORD_OPTIONS);
    const fields = passwordFields();
    for (const f of fields) setValue(f, pw); // fill confirm fields too (signup)
    void rpc({ type: 'COPY', text: pw, temporary: true }).catch(() => undefined);
    this.closeMenu();
  }

  private readonly onDocClick = (e: MouseEvent): void => {
    if (!this.panel) return;
    // Clicks land on the host element (the shadow boundary), so a click whose
    // composedPath does not include our host is "outside" -> dismiss.
    if (!e.composedPath().includes(this.host)) this.closeMenu();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.closeMenu();
  };

  // ---- autosave banner ---------------------------------------------------
  showBanner(p: { name: string; username: string; uri: string }, onSave: () => void, onDismiss: () => void): void {
    this.hideBanner();
    const b = el('div', 'banner');
    const t = el('div', 't');
    t.append(el('span', 'logo', 'JP'), el('span', undefined, 'Save this password?'));
    b.appendChild(t);
    const who = p.username ? `${p.username} · ${hostOf(p.uri)}` : hostOf(p.uri);
    b.appendChild(el('div', 'd', who));
    const btns = el('div', 'btns');
    const dismiss = el('button', 'btn', 'Not now');
    const save = el('button', 'btn primary', 'Save');
    dismiss.addEventListener('click', () => { this.hideBanner(); onDismiss(); });
    save.addEventListener('click', () => { this.hideBanner(); onSave(); });
    btns.append(dismiss, save);
    b.appendChild(btns);
    this.banner = b;
    this.root.appendChild(b);
  }

  hideBanner(): void {
    this.banner?.remove();
    this.banner = null;
  }
}
