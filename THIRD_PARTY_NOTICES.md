# Third-party software notices

The project depends on third-party npm packages whose own licenses apply. This
file records the packages added for the browser-local SDR feature and the
Street Level viewer; the complete resolved dependency inventory remains in
`package-lock.json`.

## Web RTL-SDR

- Package: `@jtarrio/webrtlsdr` 3.0.6
- Author: Jacobo Tarrio Barreiro; portions copyright Google Inc.
- Source: <https://github.com/jtarrio/webrtlsdr>
- License: Apache License 2.0
- License text: <https://www.apache.org/licenses/LICENSE-2.0>

## Signals

- Package: `@jtarrio/signals` 0.10.1
- Author: Jacobo Tarrio Barreiro
- Source: <https://github.com/jtarrio/signals>
- License: Apache License 2.0
- License text: <https://www.apache.org/licenses/LICENSE-2.0>

## MapillaryJS

- Package: `mapillary-js` 4.1.2 (loaded on demand by the Street Level viewer,
  with its stylesheet `dist/mapillary.css`)
- Author: Copyright (c) Facebook, Inc. and its affiliates
- Source: <https://github.com/mapillary/mapillary-js>
- License: MIT
- License text: <https://github.com/mapillary/mapillary-js/blob/main/LICENSE>

## RxJS (MapillaryJS dependency)

- Package: `rxjs` 7.8.2
- Author: Google, Inc., Netflix, Inc., Microsoft Corp. and contributors
- Source: <https://github.com/ReactiveX/rxjs>
- License: Apache License 2.0
- License text: <https://www.apache.org/licenses/LICENSE-2.0>

## three.js (MapillaryJS dependency)

- Package: `three` 0.134.0
- Author: Copyright © 2010-2021 three.js authors
- Source: <https://github.com/mrdoob/three.js>
- License: MIT
- License text: <https://github.com/mrdoob/three.js/blob/dev/LICENSE>

## GLOBISENT hand-gesture input

- Adapted hand-pinch tracking approach: ULTRON Orb UI by Sagar Tamang / Sagar Builds.
- Source project: https://sagartamang.com/projects/ultron
- Source license: MIT; preserved at `LICENSES/ULTRON_ORB_UI_MIT_LICENSE.txt`.
- Runtime vision library: MediaPipe Tasks Vision 0.10.35, loaded on demand from jsDelivr; see the upstream MediaPipe repository and its Apache-2.0 license for the runtime library and model terms.
- Model asset: MediaPipe Hand Landmarker hosted by Google Cloud Storage; model terms are separate from this project.

GLOBISENT does not perform face recognition or identify people. Gesture processing runs in the browser after the user explicitly enables webcam access.
