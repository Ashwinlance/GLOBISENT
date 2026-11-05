import { NEWS_CATEGORIES } from './news.js';
import { HandGestureGlobeController } from './handGestures.js';
import { DOMAINS, DOMAIN_STATUS } from './domains.js';
import { createDomainPopup } from './domainPopup.js';
import { createInfoCard } from './infoCard.js';
import { createMarkets } from './markets.js';
import { createCompanies } from './companies.js';

const REFRESH_MS = 5 * 60 * 1000;
// Opening the hub or switching back to the tab reuses results this recent.
const RECENT_MS = 60 * 1000;
const FILTER_DEBOUNCE_MS = 450;
const NEWS_ENDPOINT = '/api/globisent/news';
const PROVIDER_LABELS = { gdelt: 'GDELT', 'google-news': 'Google News (fallback)' };


const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function safeTime(value) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
}

function addOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function renderArticles(container, articles) {
  container.replaceChildren();
  if (!articles.length) {
    container.append(el('div', 'gx-empty', 'No matching articles were returned for this filter. Try another category or a broader search.'));
    return;
  }
  for (const article of articles) {
    const card = el('article', 'gx-article');
    if (article.image) {
      const image = document.createElement('img');
      image.className = 'gx-article-image';
      image.src = article.image;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => image.remove(), { once: true });
      card.append(image);
    }
    const copy = el('div', 'gx-article-copy');
    const title = document.createElement('a');
    title.className = 'gx-article-title';
    title.href = article.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.textContent = article.title;
    const meta = el('div', 'gx-article-meta', `${article.source} · ${safeTime(article.publishedAt)}`);
    copy.append(title, meta);
    card.append(copy);
    container.append(card);
  }
}

function describeGestureError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was blocked. Click the camera icon in the browser address bar and allow it for this site, and check Windows Settings › Privacy & security › Camera (allow desktop apps / your browser). Then press Enable again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No webcam was found. Connect a camera and press Enable again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The webcam is busy in another app (Teams, Zoom, Camera…). Close it and press Enable again.';
    default:
      if (/dynamically imported module|Failed to fetch/i.test(error?.message ?? '')) {
        return 'Could not download the hand-tracking model (MediaPipe). Check the internet connection and press Enable again.';
      }
      return error?.message ?? 'Unable to start hand tracking.';
  }
}

function renderDomains(container, onOpen) {
  container.replaceChildren();
  for (const domain of DOMAINS) {
    const card = el('button', 'gx-domain-card');
    card.type = 'button';
    card.dataset.domain = domain.id;
    card.setAttribute('aria-haspopup', 'dialog');
    const head = el('div', 'gx-domain-head');
    head.append(el('strong', '', domain.name), el('span', `gx-status gx-status-${domain.status}`, DOMAIN_STATUS[domain.status]));
    card.append(head, el('p', '', domain.description), el('span', 'gx-domain-open', 'OPEN DETAILS ›'));
    card.addEventListener('click', () => onOpen(domain.id));
    container.append(card);
  }
}

export function installGlobisentHub({ viewer, layers = null }) {
  if (!viewer?.camera) throw new TypeError('GLOBISENT Hub needs the initialized Cesium viewer.');
  if (document.getElementById('globisent-hub')) return () => {};

  const launcher = el('div', 'gx-launcher');
  launcher.innerHTML = `
    <button class="gx-launch-button" id="gx-open" type="button" aria-expanded="false" aria-controls="globisent-hub">
      <span class="gx-mark">G</span><span>GLOBISENT</span><span class="gx-live-dot" aria-hidden="true"></span>
    </button>
    <button class="gx-gesture-shortcut" id="gx-gesture-shortcut" type="button" title="Toggle hand gesture control">HAND CONTROL</button>
    <button class="gx-gesture-shortcut" id="gx-clickinfo-toggle" type="button" title="Show an information card when you click the globe" aria-pressed="true">CLICK INFO: ON</button>`;
  document.body.append(launcher);

  const panel = el('aside', 'gx-panel');
  panel.id = 'globisent-hub';
  panel.setAttribute('aria-label', 'GLOBISENT global intelligence hub');
  panel.innerHTML = `
    <header class="gx-panel-header">
      <div><div class="gx-eyebrow">GLOBAL INTELLIGENCE</div><h2>GLOBISENT <span>HUB</span></h2><p>One Earth. Every Signal. Unified Intelligence.</p></div>
      <button class="gx-icon-button" id="gx-close" type="button" aria-label="Close hub">×</button>
    </header>
    <nav class="gx-tabs" aria-label="Intelligence hub sections">
      <button type="button" data-tab="news" class="active">NEWS DESK</button>
      <button type="button" data-tab="markets">MARKETS</button>
      <button type="button" data-tab="companies">COMPANIES</button>
      <button type="button" data-tab="domains">DOMAINS</button>
      <button type="button" data-tab="gestures">GESTURES</button>
      <button type="button" data-tab="sources">SOURCES</button>
    </nav>
    <section class="gx-section active" data-section="news">
      <div class="gx-section-intro"><div><strong>24/7 GLOBAL NEWS</strong><small>Rolling 24-hour search · Auto-refresh every 5 minutes while this page is open</small></div><span class="gx-pulse">LIVE INDEX</span></div>
      <div class="gx-filter-grid">
        <label>REGION<select id="gx-region"><option value="global">Worldwide</option><option value="india">India focus</option></select></label>
        <label>CATEGORY<select id="gx-category"></select></label>
      </div>
      <div class="gx-search-row"><input id="gx-search" type="search" maxlength="100" placeholder="Search any topic, country or event…" autocomplete="off"><button id="gx-search-button" type="button">SEARCH</button></div>
      <div class="gx-news-status" id="gx-news-status" role="status" aria-live="polite">Waiting for news index…</div>
      <div class="gx-article-list" id="gx-articles"></div>
      <p class="gx-footnote">Headlines and links are provided by GDELT's public article index. Open each publisher for the original report. Coverage is broad, not exhaustive; source-country coverage and publication times vary.</p>
    </section>
    <section class="gx-section" data-section="markets"></section>
    <section class="gx-section" data-section="companies"></section>
    <section class="gx-section" data-section="domains">
      <div class="gx-section-intro"><div><strong>UNIVERSAL INFORMATION HUB</strong><small>Click any domain for live data, headlines and map layers</small></div></div>
      <div class="gx-domain-list" id="gx-domains"></div>
      <p class="gx-footnote">“Live map” domains switch on globe layers; “Live data” domains pull open statistics and feeds (World Bank, ECB, USGS, GDACS, CISA, OpenAlex) through the local GLOBISENT server. World Bank indicators are annual; each popup names its sources.</p>
    </section>
    <section class="gx-section" data-section="gestures">
      <div class="gx-section-intro"><div><strong>DUAL INPUT CONTROL</strong><small>Mouse and keyboard stay active when gestures are enabled</small></div><span class="gx-pulse" id="gx-gesture-status">OFF</span></div>
      <div class="gx-gesture-preview"><video id="gx-video" autoplay muted playsinline></video><canvas id="gx-overlay" width="640" height="480"></canvas><div class="gx-camera-placeholder" id="gx-camera-placeholder">CAMERA PREVIEW<br><small>Enable hand control to activate your webcam</small></div></div>
      <div class="gx-gesture-actions"><button id="gx-enable-gesture" type="button">ENABLE HAND CONTROL</button><button id="gx-disable-gesture" type="button" disabled>STOP CAMERA</button></div>
      <div class="gx-gesture-readout" id="gx-gesture-readout">Gesture camera is off. The globe remains fully controllable with mouse, touch and keyboard.</div>
      <div class="gx-gesture-guide"><div><b>ONE-HAND PINCH + MOVE</b><span>Rotate the 3D Earth</span></div><div><b>TWO-HAND PINCH + SPREAD</b><span>Zoom in and out</span></div><div><b>MOUSE / TRACKPAD</b><span>Drag to rotate · wheel to zoom · click to select</span></div><div><b>KEYBOARD</b><span>Existing GLOBISENT / map shortcuts remain available</span></div></div>
      <p class="gx-footnote">Camera access is requested only after you press Enable. Video is processed locally in the browser and is not uploaded by this gesture module. MediaPipe model/WASM files load from their published CDN endpoints.</p>
    </section>
    <section class="gx-section" data-section="sources">
      <div class="gx-section-intro"><div><strong>DATA PROVENANCE</strong><small>Know what each signal means and where it came from</small></div></div>
      <div class="gx-source-card"><strong>Global news index</strong><p>GDELT DOC 2.0 indexes articles from monitored publishers and supports topic queries, publication times and source-country metadata.</p><a href="https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/" target="_blank" rel="noopener noreferrer">GDELT API documentation ↗</a></div>
      <div class="gx-source-card"><strong>Fallback news feed</strong><p>When GDELT is rate-limiting or unreachable, the local GLOBISENT server falls back to the Google News RSS search feed. Google limits that feed to personal, non-commercial feed reading; replace it with a licensed provider before any commercial deployment.</p></div>
      <div class="gx-source-card"><strong>World markets</strong><p>Stock index, commodity futures and currency quotes come from Yahoo Finance's public chart endpoint (exchange-delayed, typically about 15 minutes; personal, non-commercial use). Crypto prices come from CoinGecko's public API. Market open/closed status uses each exchange's published trading session. Not investment advice.</p><a href="https://www.coingecko.com/en/api" target="_blank" rel="noopener noreferrer">CoinGecko API ↗</a></div>
      <div class="gx-source-card"><strong>Companies</strong><p>Company profiles combine the English Wikipedia summary with Wikidata facts (headquarters, leaders, founders, industry, products, subsidiaries and reported financials) and Yahoo Finance share prices. Wikidata is community-maintained, so leaders and figures can lag behind the latest filings.</p><a href="https://www.wikidata.org/" target="_blank" rel="noopener noreferrer">Wikidata ↗</a></div>
      <div class="gx-source-card"><strong>3D Earth and geospatial signals</strong><p>Inherited from the GOD'S EYE VIEW open-source engine. Imagery, terrain, camera and live data providers have their own attribution, quotas and license terms.</p><a href="https://github.com/bilawalsidhu/gods-eye-view" target="_blank" rel="noopener noreferrer">Upstream project and data-source guide ↗</a></div>
      <div class="gx-source-card"><strong>Hand gesture tracking</strong><p>Gesture interaction is adapted from the MIT-licensed ULTRON Orb UI hand-tracking approach and MediaPipe Tasks Vision.</p><a href="https://sagartamang.com/projects/ultron" target="_blank" rel="noopener noreferrer">ULTRON Orb UI source ↗</a></div>
      <p class="gx-footnote">A live-looking interface is not proof of live data. Each layer should display its provider, update time and any stale/fallback status supplied by its connector.</p>
    </section>`;
  document.body.append(panel);

  const openButton = launcher.querySelector('#gx-open');
  const closeButton = panel.querySelector('#gx-close');
  const gestureShortcut = launcher.querySelector('#gx-gesture-shortcut');
  const video = panel.querySelector('#gx-video');
  const overlay = panel.querySelector('#gx-overlay');
  const cameraPlaceholder = panel.querySelector('#gx-camera-placeholder');
  const gestureStatus = panel.querySelector('#gx-gesture-status');
  const gestureReadout = panel.querySelector('#gx-gesture-readout');
  const enableGesture = panel.querySelector('#gx-enable-gesture');
  const disableGesture = panel.querySelector('#gx-disable-gesture');
  const region = panel.querySelector('#gx-region');
  const category = panel.querySelector('#gx-category');
  const search = panel.querySelector('#gx-search');
  const newsStatus = panel.querySelector('#gx-news-status');
  const articles = panel.querySelector('#gx-articles');
  let gestureController = null;
  let refreshTimer = 0;
  let activeRequest = null;
  let destroyed = false;
  let debounceTimer = 0;
  let lastLoadedKey = '';
  let lastLoadedAt = 0;

  for (const [key, item] of Object.entries(NEWS_CATEGORIES)) addOption(category, key, item.label);
  const companies = createCompanies({ section: panel.querySelector('[data-section="companies"]'), viewer });
  const domainPopup = createDomainPopup({ layers, companies });
  renderDomains(panel.querySelector('#gx-domains'), (id) => domainPopup.open(id));
  const markets = createMarkets({ section: panel.querySelector('[data-section="markets"]'), viewer });

  const clickInfoToggle = launcher.querySelector('#gx-clickinfo-toggle');
  const syncClickInfo = (on) => {
    clickInfoToggle.textContent = `CLICK INFO: ${on ? 'ON' : 'OFF'}`;
    clickInfoToggle.setAttribute('aria-pressed', String(on));
    clickInfoToggle.classList.toggle('active', on);
  };
  const infoCard = createInfoCard({
    viewer,
    onEnabledChange: syncClickInfo,
  });
  syncClickInfo(infoCard.enabled);
  clickInfoToggle.addEventListener('click', () => infoCard.setEnabled(!infoCard.enabled));

  function openPanel() {
    panel.classList.add('open');
    openButton.setAttribute('aria-expanded', 'true');
    if (panel.querySelector('[data-section="news"].active')) refreshNews({ reuseRecent: true });
  }
  function closePanel() {
    panel.classList.remove('open');
    openButton.setAttribute('aria-expanded', 'false');
  }
  function setTab(name) {
    panel.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
    panel.querySelectorAll('[data-section]').forEach((section) => section.classList.toggle('active', section.dataset.section === name));
    if (name === 'news') refreshNews({ reuseRecent: true });
    if (name === 'markets') markets.activate();
    else markets.deactivate();
    if (name === 'companies') companies.activate();
  }

  function currentFilters() {
    return { category: category.value, region: region.value, q: search.value.trim() };
  }

  async function refreshNews({ reuseRecent = false } = {}) {
    if (destroyed) return;
    window.clearTimeout(debounceTimer);
    const filters = currentFilters();
    const key = JSON.stringify(filters);
    if (reuseRecent && key === lastLoadedKey && Date.now() - lastLoadedAt < RECENT_MS) return;
    activeRequest?.abort();
    const request = new AbortController();
    activeRequest = request;
    newsStatus.textContent = 'Querying global news index…';
    newsStatus.dataset.state = 'loading';
    const searchButton = panel.querySelector('#gx-search-button');
    searchButton.disabled = true;
    try {
      // Same-origin proxy: it throttles GDELT, caches and falls back (server/providers/globisentNews.js).
      const params = new URLSearchParams(filters);
      const response = await fetch(`${NEWS_ENDPOINT}?${params}`, {
        signal: AbortSignal.any ? AbortSignal.any([request.signal, AbortSignal.timeout(45000)]) : request.signal,
        headers: { Accept: 'application/json' },
      });
      let payload = null;
      try { payload = await response.json(); } catch { /* handled below */ }
      if (!response.ok || !payload || payload.error) {
        throw new Error(payload?.error ?? `News service returned HTTP ${response.status}`);
      }
      const items = Array.isArray(payload.articles) ? payload.articles : [];
      renderArticles(articles, items);
      lastLoadedKey = key;
      lastLoadedAt = Date.now();
      const provider = PROVIDER_LABELS[payload.provider] ?? payload.provider ?? 'news index';
      const fetched = payload.fetchedAt ? new Date(payload.fetchedAt).toLocaleTimeString() : new Date().toLocaleTimeString();
      const staleNote = payload.stale ? ' · showing saved results, live sources unavailable' : '';
      newsStatus.textContent = `${items.length} articles · ${provider} · updated ${fetched} · last 24 hours${staleNote}`;
      newsStatus.dataset.state = payload.stale ? 'error' : 'ready';
    } catch (error) {
      if (request.signal.aborted && activeRequest !== request) return;
      renderArticles(articles, []);
      const message = error?.name === 'TimeoutError' ? 'request timed out' : error?.message ?? 'network error';
      newsStatus.textContent = `News feed unavailable: ${message}. Try SEARCH again in a minute or check the connection.`;
      newsStatus.dataset.state = 'error';
    } finally {
      if (activeRequest === request) {
        searchButton.disabled = false;
        activeRequest = null;
      }
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => refreshNews(), FILTER_DEBOUNCE_MS);
  }

  async function startGestures() {
    if (gestureController) return;
    enableGesture.disabled = true;
    gestureReadout.textContent = 'Requesting camera permission and loading the hand model… the first start can take up to 30 seconds.';
    gestureStatus.textContent = 'LOADING';
    try {
      gestureController = new HandGestureGlobeController({
        viewer,
        video,
        overlay,
        onStatus: ({ hands, mode }) => {
          if (mode === 'off') {
            gestureStatus.textContent = 'OFF';
            gestureReadout.textContent = 'Gesture camera is off.';
          } else if (mode === 'loading') {
            gestureStatus.textContent = 'LOADING';
          } else if (mode === 'mouse') {
            gestureStatus.textContent = 'ACTIVE';
            gestureReadout.textContent = 'Mouse drag active · gesture camera movement paused until release.';
          } else {
            gestureStatus.textContent = 'ACTIVE';
            const action = mode === 'rotate' ? 'Rotating Earth' : mode === 'zoom' ? 'Zooming Earth' : 'Ready — pinch to control';
            gestureReadout.textContent = `${hands} hand(s) detected · ${action}`;
          }
        },
      });
      await gestureController.start();
      cameraPlaceholder.classList.add('hidden');
      video.classList.add('active');
      overlay.classList.add('active');
      disableGesture.disabled = false;
      gestureShortcut.classList.add('active');
    } catch (error) {
      gestureController?.destroy();
      gestureController = null;
      gestureStatus.textContent = 'ERROR';
      gestureReadout.textContent = describeGestureError(error);
      enableGesture.disabled = false;
      disableGesture.disabled = true;
      cameraPlaceholder.classList.remove('hidden');
      video.classList.remove('active');
      overlay.classList.remove('active');
      gestureShortcut.classList.remove('active');
    }
  }

  function stopGestures() {
    gestureController?.destroy();
    gestureController = null;
    enableGesture.disabled = false;
    disableGesture.disabled = true;
    cameraPlaceholder.classList.remove('hidden');
    video.classList.remove('active');
    overlay.classList.remove('active');
    gestureShortcut.classList.remove('active');
    gestureStatus.textContent = 'OFF';
    gestureReadout.textContent = 'Gesture camera is off. The globe remains fully controllable with mouse, touch and keyboard.';
  }

  openButton.addEventListener('click', () => panel.classList.contains('open') ? closePanel() : openPanel());
  closeButton.addEventListener('click', closePanel);
  panel.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
  panel.querySelector('#gx-search-button').addEventListener('click', () => refreshNews());
  search.addEventListener('keydown', (event) => { if (event.key === 'Enter') refreshNews(); });
  region.addEventListener('change', scheduleRefresh);
  category.addEventListener('change', scheduleRefresh);
  enableGesture.addEventListener('click', startGestures);
  disableGesture.addEventListener('click', stopGestures);
  gestureShortcut.addEventListener('click', () => {
    setTab('gestures');
    openPanel();
    if (gestureController) stopGestures();
    else startGestures();
  });
  const onKeyDown = (event) => {
    if (event.key.toLowerCase() !== 'g' || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    if (gestureController) stopGestures();
    else {
      setTab('gestures');
      openPanel();
      startGestures();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && panel.classList.contains('open') && panel.querySelector('[data-section="news"].active')) refreshNews();
  }, REFRESH_MS);
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && panel.classList.contains('open') && panel.querySelector('[data-section="news"].active')) refreshNews({ reuseRecent: true });
  };
  document.addEventListener('visibilitychange', onVisibility);

  // Start the news panel on first open; no network request is made until needed.
  const destroy = () => {
    destroyed = true;
    activeRequest?.abort();
    window.clearTimeout(debounceTimer);
    if (refreshTimer) window.clearInterval(refreshTimer);
    stopGestures();
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('visibilitychange', onVisibility);
    domainPopup.destroy();
    markets.destroy();
    companies.destroy();
    infoCard.destroy();
    launcher.remove();
    panel.remove();
  };
  return destroy;
}
