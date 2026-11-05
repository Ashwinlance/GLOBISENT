# GLOBISENT Build Status

**Build type:** First integrated foundation  
**Project name:** GLOBISENT  
**Date:** 2026-11-04

## Source audit

### GOD'S EYE VIEW archive

The supplied archive contains a substantial Vue 3 + Cesium + Vite application with a modular layer catalogue, local provider middleware, voice controls, scene tools and a large automated test suite. Its source code declares the MIT licence. The upstream README and data-source guide identify provider quotas, regional coverage gaps and third-party licensing restrictions.

### ULTRON archive

The supplied ULTRON archive is a separate Next.js + Three.js orb interface. Its hand tracker uses MediaPipe Tasks Vision and supports one-hand pinch/drag rotation and two-hand pinch-distance zoom. The hand-tracking approach is adapted into GLOBISENT; the orb itself does not replace the Cesium Earth.

### ARGOS ATLAS material

The supplied ARGOS material is a captured browser HAR and screenshot, not the original server repository. The capture shows a map interface with geography/country filters, 24-hour event panels, instability indicators, and counters for flights, ships, satellites, cameras, infrastructure and other layers. It does not supply the original backend services, account system, databases or proprietary feed agreements. GLOBISENT implements its own news/domain modules and uses the screen as a functional reference rather than copying the site's source.

## Implemented in this build

- Rebranded application title and loading screen as GLOBISENT.
- Added an original GLOBISENT Hub overlay with News Desk, Information Domains, Gestures and Sources tabs.
- Added GDELT DOC 2.0 JSON article search for the last 24 hours, with Worldwide/India topic focus and 24 category presets spanning politics, defence, economy, cybersecurity, science, health, climate, disasters, agriculture, demographics, travel and more.
- Added headline/source/time/original-link rendering, safe URL normalization, duplicate URL filtering, a five-minute refresh timer while the hub is open, News Desk is selected and the browser page is visible, plus status messaging.
- Added opt-in MediaPipe hand tracking. One-hand pinch movement rotates the Cesium camera; two-hand pinch-distance changes zoom the Cesium camera.
- Kept inherited Cesium mouse, trackpad, touch and keyboard navigation. Gesture mode is additive, not a replacement.
- Added explicit gesture start/stop controls and `G` shortcut, with camera stream cleanup.
- Added Windows start, install-startup and uninstall-startup scripts.
- Kept the upstream GOD'S EYE VIEW MIT licence and added the ULTRON Orb UI MIT licence notice.

## Inherited layers marked connected

The inherited codebase contains modules for flights/aircraft, military flights/awareness, AIS vessels, satellites, launches, earthquakes, fires/FIRMS, weather, wind, cyclones, public cameras/CCTV, street-level imagery, traffic, transit, bike-share, GNSS integrity, radio/SDR, air quality, infrastructure/installations, submarine cables and scene/annotation tools. Individual sources are not guaranteed to be live in every region or without keys.

## Not yet implemented as live providers

The new domain catalogue marks these as next integrations: economy/financial markets, public health datasets, research indexes, agriculture/food systems, education/demographics, culture/sport publisher feeds and cybersecurity advisories. The country profile/event timeline module and instability/event scoring are not yet connected. A defensible country/event analytics model still needs defined sources, methodology and corroboration; no scores are fabricated.

## Verification status

- `node --check` passed for `src/main.js`, `src/globisent/news.js`, `src/globisent/handGestures.js` and `src/globisent/hub.js` in the available Node 22.16.0 runtime.
- Focused unit tests passed: 7 tests, 0 failures (`node --test src/globisent/news.test.mjs src/globisent/handGestures.test.mjs`).
- The full upstream npm test suite and Vite production build were **not run**: this environment has Node 22.16.0, no project `node_modules`, and this repository declares Node 24.14+ or 26.x. A Node 24.14.0 official binary download was attempted but could not be fetched in this environment.
- Live GDELT request and webcam gesture processing: require a browser with internet access; webcam also requires localhost/HTTPS permission.
- Windows auto-start: scripts are included but not registered on the user's PC. The user must run the installer script locally.

## Known limitations

- News is a broad monitored index, not literally every article. Only headline metadata and links are displayed.
- The automatic refresh runs while the browser page is visible. Continuous collection while the computer is off/asleep or browser closed requires a separately hosted service.
- The complete ARGOS ATLAS backend was not supplied, so its private feeds, exact metrics, account services and underlying datasets cannot be ported.
- The inherited GEV source includes third-party datasets and models with their own licences. Some are explicitly non-commercial. Audit/replace those assets before commercial use.
