import { buildNewsUrl, normalizeNewsResponse, NEWS_CATEGORIES } from './news.js';
import { HandGestureGlobeController } from './handGestures.js';

const REFRESH_MS = 5 * 60 * 1000;

const DOMAINS = [
  ['Aviation & aircraft', 'Connected', 'Flights, aircraft identity, military traffic where openly published.'],
  ['Maritime & vessels', 'Connected', 'AIS vessel positions and related live-vessel layers; provider limits apply.'],
  ['Satellites & launches', 'Connected', 'Orbital propagation, satellite passes and launch information.'],
  ['Weather, climate & atmosphere', 'Connected', 'Forecast wind, observed weather products, air quality and cyclone advisories.'],
  ['Earthquakes, fires & disasters', 'Connected', 'Seismic events, active fire detections and available event perimeters.'],
  ['Public cameras & street imagery', 'Connected', 'Mapped public camera locations and supported street-level imagery providers.'],
  ['Roads, traffic & mobility', 'Connected', 'Traffic, transit, bike-share and supported route/mobility feeds.'],
  ['Infrastructure & utilities', 'Reference layers', 'Dams, datacenters, installations, power and submarine cable datasets. Licensing varies.'],
  ['News & world events', 'Connected', 'GDELT article search, global and India topic focus, 24-hour article window.'],
  ['Country profiles & event timelines', 'Next integration', 'Country reference profiles, 24-hour event timelines and corroborated geographic event records; no synthetic instability scores.'],
  ['Government, elections & policy', 'Next integration', 'Official government publications, election commissions and legislative sources required.'],
  ['Geopolitics & conflict analysis', 'Next integration', 'Verified event sources, transparent methodology and corroboration required.'],
  ['Crime & public safety', 'Next integration', 'Official public-safety bulletins and court or agency sources required.'],
  ['Economy, markets & commodities', 'Next integration', 'Dedicated market, macroeconomic, currency and commodity sources required.'],
  ['Business, trade & industry', 'Next integration', 'Company, trade, customs and industry data sources required.'],
  ['Public health & medicine', 'Next integration', 'Public-health agencies, disease surveillance and medical research sources required.'],
  ['Science, research & education', 'Next integration', 'Scholarly indexes, research repositories and education datasets required.'],
  ['Technology, AI & cybersecurity', 'Next integration', 'Technology research, incident advisories and vulnerability catalogs required.'],
  ['Agriculture, food & water', 'Next integration', 'Crop, food-price, fisheries, water and food-security sources required.'],
  ['Population & demographics', 'Next integration', 'National statistical agencies and licensed population datasets required.'],
  ['Environment & biodiversity', 'Next integration', 'Conservation, ecosystem, pollution and biodiversity datasets required.'],
  ['Transport, travel & tourism', 'Next integration', 'Rail, road, tourism, airport operations and visitor-statistics sources required.'],
  ['Culture, media & entertainment', 'Next integration', 'Publisher, event, cultural-institution and entertainment sources required.'],
  ['Sports & competitions', 'Next integration', 'Licensed schedules, results and competition data providers required.'],
];

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

function renderDomains(container) {
  container.replaceChildren();
  for (const [name, status, description] of DOMAINS) {
    const card = el('div', 'gx-domain-card');
    const head = el('div', 'gx-domain-head');
    head.append(el('strong', '', name), el('span', `gx-status gx-status-${status.toLowerCase().replaceAll(' ', '-')}`, status));
    card.append(head, el('p', '', description));
    container.append(card);
  }
}

export function installGlobisentHub({ viewer }) {
  if (!viewer?.camera) throw new TypeError('GLOBISENT Hub needs the initialized Cesium viewer.');
  if (document.getElementById('globisent-hub')) return () => {};

  const launcher = el('div', 'gx-launcher');
  launcher.innerHTML = `
    <button class="gx-launch-button" id="gx-open" type="button" aria-expanded="false" aria-controls="globisent-hub">
      <span class="gx-mark">G</span><span>GLOBISENT</span><span class="gx-live-dot" aria-hidden="true"></span>
    </button>
    <button class="gx-gesture-shortcut" id="gx-gesture-shortcut" type="button" title="Toggle hand gesture control">HAND CONTROL</button>`;
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
    <section class="gx-section" data-section="domains">
      <div class="gx-section-intro"><div><strong>UNIVERSAL INFORMATION HUB</strong><small>Live map layers, reference datasets and planned connectors</small></div></div>
      <div class="gx-domain-list" id="gx-domains"></div>
      <p class="gx-footnote">“Connected” means an existing GLOBISENT base layer or the new news index is present in this build. “Next integration” is not presented as live data.</p>
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

  for (const [key, item] of Object.entries(NEWS_CATEGORIES)) addOption(category, key, item.label);
  renderDomains(panel.querySelector('#gx-domains'));

  function openPanel() {
    panel.classList.add('open');
    openButton.setAttribute('aria-expanded', 'true');
    refreshNews();
  }
  function closePanel() {
    panel.classList.remove('open');
    openButton.setAttribute('aria-expanded', 'false');
  }
  function setTab(name) {
    panel.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
    panel.querySelectorAll('[data-section]').forEach((section) => section.classList.toggle('active', section.dataset.section === name));
    if (name === 'news') refreshNews();
  }

  async function refreshNews() {
    if (destroyed) return;
    activeRequest?.abort();
    activeRequest = new AbortController();
    newsStatus.textContent = 'Querying global news index…';
    newsStatus.dataset.state = 'loading';
    panel.querySelector('#gx-search-button').disabled = true;
    try {
      const url = buildNewsUrl({ category: category.value, region: region.value, search: search.value });
      const response = await fetch(url, {
        signal: activeRequest.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`News index returned HTTP ${response.status}.`);
      const payload = await response.json();
      const items = normalizeNewsResponse(payload);
      renderArticles(articles, items);
      const updated = new Date().toLocaleTimeString();
      newsStatus.textContent = `${items.length} articles · refreshed ${updated} · last 24 hours`;
      newsStatus.dataset.state = 'ready';
    } catch (error) {
      if (error?.name === 'AbortError') return;
      renderArticles(articles, []);
      newsStatus.textContent = `News feed unavailable: ${error?.message ?? 'network error'}. Try Refresh or check the connection.`;
      newsStatus.dataset.state = 'error';
    } finally {
      panel.querySelector('#gx-search-button').disabled = false;
    }
  }

  async function startGestures() {
    if (gestureController) return;
    enableGesture.disabled = true;
    gestureReadout.textContent = 'Requesting camera permission and loading the hand model…';
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
      gestureReadout.textContent = error?.message ?? 'Unable to start hand tracking.';
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
  panel.querySelector('#gx-search-button').addEventListener('click', refreshNews);
  search.addEventListener('keydown', (event) => { if (event.key === 'Enter') refreshNews(); });
  region.addEventListener('change', refreshNews);
  category.addEventListener('change', refreshNews);
  enableGesture.addEventListener('click', startGestures);
  disableGesture.addEventListener('click', stopGestures);
  gestureShortcut.addEventListener('click', () => {
    openPanel();
    setTab('gestures');
    if (gestureController) stopGestures();
    else startGestures();
  });
  const onKeyDown = (event) => {
    if (event.key.toLowerCase() !== 'g' || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    if (gestureController) stopGestures();
    else {
      openPanel();
      setTab('gestures');
      startGestures();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && panel.classList.contains('open') && panel.querySelector('[data-section="news"].active')) refreshNews();
  }, REFRESH_MS);
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && panel.classList.contains('open') && panel.querySelector('[data-section="news"].active')) refreshNews();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // Start the news panel on first open; no network request is made until needed.
  const destroy = () => {
    destroyed = true;
    activeRequest?.abort();
    if (refreshTimer) window.clearInterval(refreshTimer);
    stopGestures();
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('visibilitychange', onVisibility);
    launcher.remove();
    panel.remove();
  };
  return destroy;
}
