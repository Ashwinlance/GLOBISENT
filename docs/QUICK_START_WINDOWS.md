# GLOBISENT — Windows Quick Start

## 1. Install the supported Node.js runtime

This project declares Node.js `24.14+` or `26.x`. Use the official Node.js Windows x64 installer from:

https://nodejs.org/en/download/archive/v24.14.0

After installation, open a new PowerShell window and confirm:

```powershell
node --version
npm --version
```

## 2. Extract and install

Extract `GLOBISENT_Project_v1.zip` into a normal writable folder such as `C:\Projects\GLOBISENT`.

Open PowerShell in that folder and run:

```powershell
npm ci
npm run doctor
```

## 3. Start GLOBISENT

```powershell
npm run dev
```

Open the localhost URL printed by Vite. The default upstream development port is `4173`.

You can also double-click:

```text
scripts\windows\Start-GLOBISENT.bat
```

The batch launcher expects dependencies to have been installed once with `npm ci`.

## 4. Use the GLOBISENT Hub

1. Wait for the Cesium 3D Earth to finish loading.
2. Select the **GLOBISENT** button in the upper-right area.
3. Open **NEWS DESK** for Worldwide/India coverage, category filters and topic search.
4. Open **DOMAINS** to distinguish connected map layers from reference data and future integrations.
5. Open **GESTURES** and explicitly enable the webcam to activate hand tracking.

Mouse, trackpad, keyboard and touch globe navigation remain available while gesture control is on. A single pinched hand rotates the Earth; two pinched hands control zoom.

## 5. Optional automatic startup

Automatic startup is opt-in. Once GLOBISENT runs successfully, use PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Install-Startup.ps1
```

Remove it later with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\Uninstall-Startup.ps1
```

This starts the local web application after the Windows user signs in. It does not keep news collection running while Windows is off/asleep or the browser is closed.

## 6. Check sources and configure providers

Open the **SOURCES** tab and review `DATA_SOURCES.md`, `.env.example`, and the upstream provider setup documentation. Set only the credentials needed for the feeds you intend to use. Never paste API keys, passwords, session cookies, or authenticated HAR exports into source files or public repositories.

## Troubleshooting

- **Node version error:** install Node.js 24.14+ or 26.x, then reopen the terminal.
- **Dependency error:** run `npm ci` from the project root.
- **Map/provider not available:** check the provider setup, network connection, credential, terms and regional coverage.
- **Gesture camera unavailable:** use localhost or HTTPS, permit webcam access, and check that another application is not holding the camera.
- **News unavailable:** check internet access and retry; the News Desk depends on the external GDELT service.
