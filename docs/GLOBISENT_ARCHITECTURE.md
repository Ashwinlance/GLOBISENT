# GLOBISENT Architecture

## High-level design

```text
GLOBISENT Desktop Browser Shell
          |
          +-- Cesium 3D Earth (inherited GOD'S EYE VIEW engine)
          |      +-- imagery / terrain / map stack
          |      +-- aircraft, vessels, satellites, launches
          |      +-- weather, wind, cyclones, earthquakes, fires
          |      +-- cameras, traffic, transit, infrastructure, radio
          |      +-- voice, annotations, scene director, share views
          |
          +-- GLOBISENT Hub (new overlay)
                 +-- News Desk -> GDELT DOC 2.0 public article index
                 +-- Information Domains -> connected/reference/planned catalogue
                 +-- Gesture Control -> MediaPipe HandLandmarker -> Cesium camera
                 +-- Sources -> provider and licensing provenance
          |
          +-- Windows launcher / optional HKCU Run startup entry
```

## Startup sequence

1. Vite loads the application shell and the existing Vue views.
2. The inherited standalone application creates the Cesium viewer and map/data layers.
3. When the application startup promise resolves, GLOBISENT mounts its own overlay around the initialized viewer.
4. No news query is made until the user opens the Hub; thereafter a five-minute timer refreshes while the browser page remains visible.
5. Hand tracking remains off until the user explicitly presses Enable. MediaPipe code/model resources load on demand; camera permission is requested from the browser.

## Gesture signal path

```text
User enables gesture mode
  -> browser getUserMedia permission
  -> local video stream
  -> MediaPipe HandLandmarker
  -> thumb/index pinch detection with hysteresis
  -> one pinched hand: Cesium camera rotateRight/rotateUp
  -> two pinched hands: Cesium camera zoomIn/zoomOut
```

The existing Cesium mouse/keyboard/touch handlers are not removed or replaced. Turning gesture mode off stops the animation loop, closes the hand landmarker and stops every camera track.

## News signal path

```text
News filter controls
  -> category + region + optional topic
  -> GDELT DOC 2.0 ArticleList JSON request
  -> normalize safe HTTP(S) article links, title, source, seendate, image
  -> render title/source/time and outbound publisher link
```

Only metadata and publisher URLs are displayed. GLOBISENT does not store or republish full article bodies in this client module.

## Data classification

- **Live/regular feeds:** data from providers that currently respond and are configured for the region.
- **Reference layers:** static or infrequently updated datasets; the UI should not label them live.
- **Planned connectors:** domains named in the roadmap but not currently connected.
- **Provider unavailable:** display the upstream failure or stale state; never replace it with fabricated data.

## Future extension boundaries

The next planned integration seams are isolated modules/providers for:

- Country reference profiles and country-level event chronology.
- Economic and market indicators.
- Public-health and disaster agency feeds.
- Research/publication indexes.
- Cybersecurity advisories and vulnerability catalogs.
- Agriculture, food systems and environment datasets.
- Persistent scheduled news ingestion, alerts, deduplication and historical archive.

Each provider should include an explicit licence/terms entry, attribution, data freshness, regional coverage and failure behaviour before it is enabled in the default UI.
