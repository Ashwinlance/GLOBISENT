# GLOBISENT

## Global Intelligence & Information Command Center

**One Earth. Every Signal. Unified Intelligence.**

GLOBISENT is an integrated global information workspace built on the open-source **GOD'S EYE VIEW** Cesium engine. It combines the original real-time 3D Earth, public geospatial signals and voice capabilities with a GLOBISENT command hub, a global/India news desk, and optional webcam hand-gesture controls. Standard mouse, keyboard and touch navigation remain available.

> This first integrated build is a functional foundation, not a claim that every information domain is already connected. The GLOBISENT hub labels current layers separately from reference datasets and future integrations.

## What's included in this build

### Existing 3D Earth and public-data engine

The inherited application includes a Cesium-powered 3D Earth, satellite imagery and terrain paths, aircraft and military-flight layers where public data permits, vessels, satellites and launches, earthquakes, fires, weather and wind products, cyclones, public camera and street-level imagery integrations, traffic and mobility layers, infrastructure/reference layers, radio/SDR capabilities, voice interaction, annotations, scene capture and shareable views. Availability varies by provider, region, credentials, quota and licence.

### GLOBISENT Intelligence Hub

Open the **GLOBISENT** control at the upper-right of the globe. The hub includes:

- **News Desk:** GDELT global article search with Worldwide/India focus, category selection, free-text topic search, timestamps, publisher links, a 24-hour search window and a five-minute refresh while the page is visible.
- **Information Domains:** A catalogue showing inherited live map layers, reference datasets and domains that still need a dedicated provider.
- **Gesture Control:** Enable the webcam to rotate the Earth with one pinched hand and zoom with two pinched hands.
- **Sources:** Provider and upstream attribution notes.

### Dual controls

- Mouse/trackpad/touch: the existing Cesium globe controls are preserved.
- One-hand pinch and move: rotate the Earth.
- Two-hand pinch and spread/close: zoom in/out.
- Press `G` to toggle hand control from the page when focus is not inside a form control.
- Webcam access is off by default and is requested only after the user enables the feature.

## Requirements

- Windows 10/11, macOS or Linux.
- **Node.js 24.14+ or Node.js 26.x**, matching the upstream engine's declared support range.
- npm compatible with the installed Node release.
- A modern browser with WebGL/WebGL2. Microsoft Edge or Chrome is recommended.
- Webcam for hand control; gesture mode requires `localhost` or HTTPS and camera permission.
- Internet access for live data, map imagery and the on-demand MediaPipe model/WASM.

## Run on Windows

1. Install a supported Node.js version (24.14+ or 26.x).
2. Extract the project folder to a normal writable location, for example `C:\Projects\GLOBISENT`.
3. Open PowerShell or Command Prompt in that folder.
4. Install the dependencies once:

   ```powershell
   npm ci
   ```

5. Run the project's setup checks:

   ```powershell
   npm run doctor
   ```

6. Start the application:

   ```powershell
   npm run dev
   ```

7. Open the local address printed by Vite (the upstream default is `http://localhost:4173`).

You can also double-click `scripts\windows\Start-GLOBISENT.bat` after dependencies are installed.

## Optional Windows startup

Automatic startup is **not silently enabled**. After you have run the app successfully once, open PowerShell in the project folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Install-Startup.ps1
```

To remove the startup entry:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Uninstall-Startup.ps1
```

This adds/removes a per-user entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. The computer must be powered on and signed in for continuous news refresh; a browser cannot refresh while Windows is shut down or asleep.

## News coverage and limitations

The first News Desk uses the public GDELT DOC 2.0 article index. GDELT supports article-list JSON, topic queries, source-country/language metadata and a rolling coverage window. GLOBISENT refreshes its current selection every five minutes while the page is visible. It displays headlines, source domains, timestamps and original publisher links; it does **not** copy full publisher articles.

News coverage is broad but not exhaustive. GDELT's monitoring footprint varies by publisher, country and language; it may omit stories, return duplicates across outlets, or contain incorrect machine classifications. The category list is a topic search taxonomy, not a guarantee that every story in the world is captured. For commercial use, review each provider's terms and obtain required permissions.

The five-minute refresh is a browser-session feature. For unattended 24/7 collection, retention, alerts and server-side schedules, a separately deployed service and its hosting/monitoring configuration will be required.

## Information-domain coverage

This build deliberately distinguishes:

- **Connected:** inherited live/geospatial layers or GDELT news search are present in the codebase.
- **Reference layers:** bundled or external reference datasets exist, but may be static, region-limited or separately licensed.
- **Next integration:** the interface records the requested domain, but a dedicated authoritative data provider is not yet connected.

Economy/markets, public health, research, agriculture, demographics, education, culture and cybersecurity require additional source integrations. Do not treat a domain as live merely because it appears in the catalogue.

## Data, licensing and privacy

- The inherited GOD'S EYE VIEW source code is MIT-licensed; preserve the upstream copyright and licence notice.
- The adapted gesture-control approach is MIT-licensed; see `LICENSES/ULTRON_ORB_UI_MIT_LICENSE.txt`.
- The original ARGOS ATLAS material supplied for this project was a browser HAR capture and screenshot, not the original backend repository. GLOBISENT recreates requested concepts in its own modules; it does not copy the captured site's proprietary backend or private services.
- Third-party map imagery, 3D models, bundled datasets and runtime feeds have their own licences and attribution requirements. The upstream `LICENSE`, `DATA_SOURCES.md`, `THIRD_PARTY_NOTICES.md` and model README must be reviewed before redistribution or commercial deployment.
- In particular, some bundled upstream data is marked non-commercial. The upstream MIT software licence does not grant commercial rights to those datasets or third-party 3D assets.
- API credentials should be placed in `.env` or the app's provider settings as directed by the upstream documentation. Never commit `.env`, API keys, session cookies or HAR files containing authentication material.
- Webcam access is opt-in. This module uses hand landmarks for control; it does not identify the person in view and does not upload webcam frames.
- The upstream project's safety boundary excludes named-person search, face recognition and individual tracking. GLOBISENT retains that boundary.

## Project documentation

- `docs/GLOBISENT_BUILD_STATUS.md` — what was actually integrated and what remains.
- `docs/GLOBISENT_ARCHITECTURE.md` — system architecture and data flow.
- `docs/QUICK_START_WINDOWS.md` — Windows setup, run and optional startup instructions.
- `docs/GLOBISENT_Master_Project_Documentation.docx` — master requirements and project specification.
- `docs/UPSTREAM_GODS_EYE_VIEW_README.md` — full upstream feature and setup documentation.
- `DATA_SOURCES.md` — inherited provider and data-source notes.
- `SECURITY.md` — upstream security model and deployment cautions.

## Tests and build

```powershell
npm test
npm run build
```

The upstream repository includes a broad automated test suite. Run it on the supported Node version after installing the locked dependencies. Some live data integrations additionally require network connectivity and optional provider credentials.

## Attribution

GLOBISENT's current globe engine is based on [GOD'S EYE VIEW](https://github.com/bilawalsidhu/gods-eye-view) by Bilawal Sidhu (MIT; see `LICENSE`). Hand gesture control adapts the MIT-licensed ULTRON Orb UI hand-tracking approach by Sagar Tamang / Sagar Builds (see `LICENSES/ULTRON_ORB_UI_MIT_LICENSE.txt`). The ARGOS ATLAS browser capture was used only as a functional/UI reference for original GLOBISENT modules.
