/**
 * Domain detail popup for the GLOBISENT hub. Opens when a domain card is
 * clicked: live statistics/feeds from /api/globisent/domain, the latest
 * headlines from /api/globisent/news, and switches for the domain's map layers.
 */
import { DOMAIN_BY_ID, DOMAIN_COUNTRIES, DOMAIN_STATUS } from './domains.js';
import { NEWS_CATEGORIES } from './news.js';
import { DOMAIN_COMPANY_SECTORS, SECTOR_BY_ID } from './companyCatalog.js';

const LAYER_LABELS = {
  flights: 'Aircraft', military: 'Military flights', 'military-awareness': 'Military awareness',
  'local-adsb': 'Local ADS-B', 'ais-live-vessels': 'Ships (AIS)', 'submarine-cables': 'Submarine cables',
  satellites: 'Satellites', 'rocket-launches': 'Rocket launches', wind: 'Wind', 'weather-cyclones': 'Cyclones',
  'air-quality': 'Air quality', earthquakes: 'Earthquakes', 'local-firms': 'Active fires (FIRMS)', 'fire-perimeters': 'Fire perimeters',
  cctv: 'Public cameras', 'street-level': 'Street-level imagery', traffic: 'Traffic', transit: 'Transit',
  bikeshare: 'Bike-share', 'military-installations': 'Installations', 'gnss-integrity': 'GNSS integrity', radio: 'Radio',
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

function safeLink(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function link(url, text, className) {
  const href = safeLink(url);
  if (!href) return el('span', className, text);
  const a = el('a', className, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function when(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function tagButton(item) {
  const button = el('button', 'gx-pop-tag gx-pop-tag-button', item.label);
  button.type = 'button';
  if (item.color) {
    const dot = el('i');
    dot.style.background = item.color;
    button.prepend(dot);
  }
  if (item.detail) button.title = item.detail;
  button.addEventListener('click', item.onClick);
  return button;
}

export function renderSection(section) {
  const box = el('section', 'gx-pop-section');
  const head = el('div', 'gx-pop-section-head');
  head.append(el('strong', '', section.title));
  if (section.source) head.append(link(section.sourceUrl, `${section.source} ↗`, 'gx-pop-source'));
  box.append(head);
  if (section.kind === 'error') {
    box.append(el('p', 'gx-pop-error', `Source temporarily unavailable: ${section.error}`));
    return box;
  }
  if (section.kind === 'text') {
    box.append(el('p', 'gx-pop-text', section.text ?? ''));
    return box;
  }
  if (!section.items?.length) {
    box.append(el('p', 'gx-pop-empty', 'No records right now.'));
    return box;
  }
  if (section.kind === 'tags') {
    const tags = el('div', 'gx-pop-tags');
    for (const item of section.items) tags.append(item.onClick ? tagButton(item) : el('span', 'gx-pop-tag', item.label));
    box.append(tags);
    return box;
  }
  if (section.kind === 'stats') {
    const grid = el('div', 'gx-pop-stats');
    for (const item of section.items) {
      const cell = el('div', 'gx-pop-stat');
      cell.append(el('span', 'gx-pop-stat-label', item.label));
      cell.append(item.url ? link(item.url, item.value, 'gx-pop-stat-value') : el('b', 'gx-pop-stat-value', item.value));
      if (item.detail) cell.append(el('small', '', item.detail));
      grid.append(cell);
    }
    box.append(grid);
  } else {
    const list = el('ol', 'gx-pop-list');
    for (const item of section.items) {
      const row = el('li');
      row.append(link(item.url, item.label, 'gx-pop-item-title'));
      const meta = [item.detail, when(item.time)].filter(Boolean).join(' · ');
      if (meta) row.append(el('small', '', meta));
      list.append(row);
    }
    box.append(list);
  }
  return box;
}

export function createDomainPopup({ layers = null, companies = null } = {}) {
  const overlay = el('div', 'gx-pop-overlay');
  overlay.hidden = true;
  const dialog = el('div', 'gx-pop');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  overlay.append(dialog);
  document.body.append(overlay);

  let current = null;
  let request = null;
  let unsubscribe = null;
  let country = 'IND';

  function close() {
    request?.abort();
    request = null;
    unsubscribe?.();
    unsubscribe = null;
    overlay.hidden = true;
    current = null;
    dialog.replaceChildren();
  }

  function layerAvailable(id) {
    return Boolean(layers?.layers?.has?.(id));
  }

  function renderLayerButtons(container, domain) {
    container.replaceChildren();
    const ids = domain.layers.filter(layerAvailable);
    if (!ids.length) return;
    container.append(el('div', 'gx-pop-label', 'SHOW ON THE GLOBE'));
    const row = el('div', 'gx-pop-layers');
    for (const id of ids) {
      const on = Boolean(layers.isEffectivelyEnabled?.(id));
      const button = el('button', `gx-pop-layer${on ? ' on' : ''}`, `${on ? '● ' : '○ '}${LAYER_LABELS[id] ?? id}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(on));
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await layers.setEnabled(id, !on, { origin: 'user' });
        } catch (error) {
          console.warn('[GLOBISENT] layer toggle failed', id, error);
        }
        if (current === domain) renderLayerButtons(container, domain);
      });
      row.append(button);
    }
    container.append(row);
  }

  /**
   * Offer to save a missing provider key (e.g. AISStream for ships) through
   * the app's own Provider Settings route: loopback + same-origin only, an
   * atomic .env write restricted to this account, then a dev-server restart.
   */
  async function renderKeyBox(slot, domain) {
    const spec = domain.key;
    if (!spec) return;
    let partial = false;
    const missing = async () => {
      try {
        const r = await fetch(spec.status, { cache: 'no-store' });
        const j = await r.json().catch(() => null);
        // A keyless fallback (e.g. Baltic ships) still reports keyMissing.
        partial = j?.keyMissing === true && j?.status !== 'missing-key';
        return j?.status === 'missing-key' || j?.keyMissing === true;
      } catch {
        return false;
      }
    };
    if (!(await missing()) || current !== domain) return;
    const form = el('form', 'gx-agent-key');
    form.append(el('strong', '', `Connect ${spec.what}`));
    const p = el('p');
    p.append(partial && spec.partial ? `${spec.partial} For ${spec.what} worldwide, ${spec.name} needs a free API key. Create one at ` : `${spec.name} needs a free API key. Create one at `);
    const a = el('a', '', `${new URL(spec.url).host} ↗`);
    a.href = spec.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    p.append(a, '. It is saved to the local GLOBISENT .env file on this computer and never shown again.');
    const row = el('div', 'gx-agent-key-row');
    const input = el('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = `${spec.name} API key`;
    input.setAttribute('aria-label', `${spec.name} API key`);
    const save = el('button', '', 'SAVE KEY');
    save.type = 'submit';
    row.append(input, save);
    const status = el('small');
    status.setAttribute('role', 'status');
    form.append(p, row, status);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const key = input.value.replace(/\s+/g, '').replace(/^['"]+|['"]+$/g, '');
      if (key.length < 16) {
        status.textContent = 'That key looks too short. Copy the whole key from your account page.';
        status.dataset.state = 'error';
        return;
      }
      save.disabled = true;
      status.textContent = 'Saving…';
      status.dataset.state = '';
      try {
        const response = await fetch('/api/setup/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [spec.env]: key }),
          cache: 'no-store',
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) throw new Error(data?.error ?? `Save failed (HTTP ${response.status})`);
        input.value = '';
        status.textContent = 'Saved. Restarting GLOBISENT…';
        for (let attempt = 0; attempt < 40; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (!(await missing())) {
            form.replaceChildren(el('strong', '', `${spec.name} connected`), el('p', '', `Switch on the layer above to see ${spec.what}. Ships appear as AIS messages arrive, usually within a minute.`));
            return;
          }
        }
        status.textContent = 'Saved, but the server has not picked it up yet. Reload the page in a few seconds.';
      } catch (error) {
        status.textContent = error?.message ?? 'Could not save the key.';
        status.dataset.state = 'error';
      } finally {
        save.disabled = false;
      }
    });
    slot.replaceChildren(form);
  }

  /** Major companies for this domain (by sector) or, for country profiles, by headquarters country. */
  async function renderCompanies(slot, domain) {
    slot.replaceChildren();
    const sectors = DOMAIN_COMPANY_SECTORS[domain.id] ?? [];
    const byCountry = domain.id === 'country';
    if (!companies || (!sectors.length && !byCountry)) return;
    const wantedCountry = country;
    let list;
    try {
      list = await companies.companiesFor(byCountry ? { iso3: country } : { sectors });
    } catch {
      return;
    }
    if (current !== domain || country !== wantedCountry) return;
    const title = byCountry
      ? `Major companies headquartered here · ${list.length}`
      : `Major companies · ${sectors.map((s) => SECTOR_BY_ID.get(s)?.name).filter(Boolean).join(', ')}`;
    slot.replaceChildren(renderSection({
      title,
      kind: 'tags',
      items: list.slice(0, 60).map((company) => ({
        label: company.name,
        color: SECTOR_BY_ID.get(company.sectors[0])?.color,
        detail: [company.hq, company.country].filter(Boolean).join(', '),
        onClick: () => companies.open(company.id, company),
      })),
    }));
  }

  async function loadData(domain, body) {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    body.replaceChildren(el('p', 'gx-pop-loading', 'Loading live data…'));
    const needsData = domain.indicators.length || domain.feeds.length || domain.profile;
    const region = country === 'IND' ? 'india' : 'global';
    const tasks = [
      needsData
        ? fetch(`/api/globisent/domain?${new URLSearchParams({ id: domain.id, country })}`, { signal: controller.signal })
          .then((r) => r.json())
        : Promise.resolve({ sections: [] }),
      fetch(`/api/globisent/news?${new URLSearchParams({ category: domain.news, region, q: '' })}`, { signal: controller.signal })
        .then((r) => r.json())
        .catch((error) => ({ error: error?.message })),
    ];
    let data;
    let news;
    try {
      [data, news] = await Promise.all(tasks);
    } catch (error) {
      if (controller.signal.aborted) return;
      body.replaceChildren(el('p', 'gx-pop-error', `Could not load data: ${error?.message ?? 'network error'}`));
      return;
    }
    if (controller.signal.aborted || current !== domain) return;
    body.replaceChildren();
    for (const section of data?.sections ?? []) body.append(renderSection(section));
    const headlines = Array.isArray(news?.articles) ? news.articles.slice(0, 10) : [];
    body.append(renderSection(news?.error
      ? { title: 'Latest headlines', kind: 'error', error: news.error }
      : {
        title: `Latest headlines · ${NEWS_CATEGORIES[domain.news]?.label ?? 'News'}${region === 'india' ? ' · India' : ''}`,
        source: news?.provider === 'gdelt' ? 'GDELT' : 'Google News',
        sourceUrl: news?.provider === 'gdelt' ? 'https://www.gdeltproject.org/' : 'https://news.google.com/',
        kind: 'list',
        items: headlines.map((a) => ({ label: a.title, url: a.url, detail: a.source, time: a.publishedAt })),
      }));
    if (data?.generatedAt) body.append(el('p', 'gx-footnote', `Updated ${when(data.generatedAt)}. Values are the latest each source publishes; World Bank indicators are annual.`));
  }

  function open(domainId) {
    const domain = DOMAIN_BY_ID.get(domainId);
    if (!domain) return;
    close();
    current = domain;
    overlay.hidden = false;

    const header = el('header', 'gx-pop-header');
    const titles = el('div');
    titles.append(el('div', 'gx-eyebrow', 'GLOBISENT DOMAIN'));
    titles.append(el('h3', '', domain.name));
    const status = DOMAIN_STATUS[domain.status] ?? domain.status;
    titles.append(el('span', `gx-status gx-status-${domain.status}`, status));
    const closeButton = el('button', 'gx-icon-button', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.addEventListener('click', close);
    header.append(titles, closeButton);

    const description = el('p', 'gx-pop-description', domain.description);
    const keySlot = el('div', 'gx-pop-keyslot');
    renderKeyBox(keySlot, domain);
    const layerBox = el('div', 'gx-pop-layerbox');
    renderLayerButtons(layerBox, domain);
    if (typeof layers?.subscribe === 'function') {
      const off = layers.subscribe((event) => {
        if (current === domain && event?.type !== 'status') renderLayerButtons(layerBox, domain);
      });
      unsubscribe = typeof off === 'function' ? off : null;
    }

    const controls = el('div', 'gx-pop-controls');
    const label = el('label', '', 'COUNTRY');
    const select = el('select');
    for (const [code, name] of DOMAIN_COUNTRIES) {
      const option = el('option', '', name);
      option.value = code;
      select.append(option);
    }
    select.value = country;
    label.append(select);
    const refresh = el('button', '', 'REFRESH');
    refresh.type = 'button';
    controls.append(label, refresh);

    const companySlot = el('div', 'gx-pop-companies');
    const body = el('div', 'gx-pop-body');
    select.addEventListener('change', () => {
      country = select.value;
      loadData(domain, body);
      renderCompanies(companySlot, domain);
    });
    refresh.addEventListener('click', () => loadData(domain, body));

    dialog.setAttribute('aria-label', domain.name);
    dialog.replaceChildren(header, description, keySlot, layerBox, controls, companySlot, body);
    closeButton.focus();
    loadData(domain, body);
    renderCompanies(companySlot, domain);
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  const onKey = (event) => {
    if (event.key === 'Escape' && !overlay.hidden) close();
  };
  document.addEventListener('keydown', onKey);

  return {
    open,
    close,
    destroy() {
      close();
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    },
  };
}
