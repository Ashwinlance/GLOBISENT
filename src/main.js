import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { t } from './i18n/index.js';
import { installGlobisentHub } from './globisent/hub.js';

// The Vite boundary exposes only undefined, null, or a validated URL.
const photonSetting = import.meta.env.PHOTON_URL;

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  geospatial:
    photonSetting === undefined ? {} : { endpoints: { photon: photonSetting } },
  allowQaRegistration: import.meta.env.DEV,
});

application.start().then((components) => {
  // The full Cesium viewer remains the map engine; GLOBISENT adds its own
  // news, domain and optional hand-gesture controls around that viewer.
  const disposeHub = installGlobisentHub({
    viewer: components.scene.viewer,
    layers: components.data?.dataManager ?? null,
  });
  window.addEventListener('pagehide', disposeHub, { once: true });
}).catch((error) => {
  console.error("God's Eye View initialization failed:", error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = t('Error: {message}', {
    message: describeError(error),
  });
  loaderStatus.style.color = '#ff4444';
});

export { application };
