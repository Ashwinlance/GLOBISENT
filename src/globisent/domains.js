/**
 * GLOBISENT information domains, shared by the hub (browser) and the
 * /api/globisent/domain server route. Every domain is backed by at least one
 * keyless public source: inherited map layers, the news proxy, and/or open
 * statistical APIs fetched through the GLOBISENT server.
 *
 * `layers`     map layer ids the popup can switch on (ignored if not registered)
 * `news`       NEWS_CATEGORIES key used for the popup's latest headlines
 * `indicators` World Bank indicator codes shown for the selected country
 * `feeds`      extra live feeds fetched by the server (see FEEDS below)
 */

export const DOMAIN_STATUS = Object.freeze({
  map: 'Live map',
  data: 'Live data',
});

export const DOMAINS = Object.freeze([
  {
    id: 'aviation', name: 'Aviation & aircraft', status: 'map', news: 'transport',
    description: 'Live aircraft positions, military traffic where openly published, and local ADS-B receivers.',
    layers: ['flights', 'military', 'military-awareness', 'local-adsb'],
    indicators: ['IS.AIR.PSGR', 'IS.AIR.DPRT'],
  },
  {
    id: 'maritime', name: 'Maritime & vessels', status: 'map', news: 'transport',
    description: 'AIS vessel positions and live-vessel layers; provider coverage limits apply.',
    // Live ships need a free AISStream key; the popup offers to save one.
    key: { env: 'AISSTREAM_API_KEY', name: 'AISStream', url: 'https://aisstream.io/apikeys', status: '/api/vessels/status', what: 'live ships' },
    layers: ['ais-live-vessels', 'submarine-cables'],
    indicators: ['IS.SHP.GOOD.TU'],
  },
  {
    id: 'space', name: 'Satellites & launches', status: 'map', news: 'space',
    description: 'Orbital propagation of satellites, passes and upcoming rocket launches.',
    layers: ['satellites', 'rocket-launches'],
  },
  {
    id: 'weather', name: 'Weather, climate & atmosphere', status: 'map', news: 'climate',
    description: 'Forecast wind, observed weather, air quality and tropical-cyclone advisories, plus current global disaster alerts.',
    layers: ['wind', 'weather-cyclones', 'air-quality'],
    feeds: ['gdacs'],
  },
  {
    id: 'disasters', name: 'Earthquakes, fires & disasters', status: 'map', news: 'disasters',
    description: 'USGS earthquakes from the last 24 hours, GDACS orange/red alerts, satellite fire detections and fire perimeters.',
    layers: ['earthquakes', 'local-firms', 'fire-perimeters'],
    feeds: ['usgs', 'gdacs'],
  },
  {
    id: 'cameras', name: 'Public cameras & street imagery', status: 'map', news: 'world',
    description: 'Mapped public camera locations and street-level imagery (KartaView and Panoramax work without a key).',
    layers: ['cctv', 'street-level'],
  },
  {
    id: 'mobility', name: 'Roads, traffic & mobility', status: 'map', news: 'transport',
    description: 'Traffic, public transit, bike-share and supported mobility feeds.',
    layers: ['traffic', 'transit', 'bikeshare'],
    indicators: ['IS.ROD.PAVE.ZS', 'IS.RRS.TOTL.KM'],
  },
  {
    id: 'infrastructure', name: 'Infrastructure & utilities', status: 'map', news: 'energy',
    description: 'Installations, submarine cables, radio and GNSS integrity layers with national access indicators.',
    layers: ['military-installations', 'submarine-cables', 'gnss-integrity', 'radio'],
    indicators: ['EG.ELC.ACCS.ZS', 'IT.NET.USER.ZS', 'EG.USE.ELEC.KH.PC'],
  },
  {
    id: 'news', name: 'News & world events', status: 'data', news: 'world',
    description: 'Rolling 24-hour headlines from GDELT with a Google News fallback, plus active GDACS disaster alerts.',
    feeds: ['gdacs'],
  },
  {
    id: 'country', name: 'Country profiles', status: 'data', news: 'world', profile: true,
    description: 'Country reference profile from the World Bank: capital, region, income group, population, economy and life expectancy.',
    indicators: ['SP.POP.TOTL', 'NY.GDP.MKTP.CD', 'NY.GDP.PCAP.CD', 'SP.DYN.LE00.IN', 'SP.URB.TOTL.IN.ZS'],
  },
  {
    id: 'government', name: 'Government, elections & policy', status: 'data', news: 'politics',
    description: 'Policy and election headlines with fiscal indicators for the selected country.',
    indicators: ['GC.REV.XGRT.GD.ZS', 'GC.XPN.TOTL.GD.ZS', 'GC.DOD.TOTL.GD.ZS'],
  },
  {
    id: 'geopolitics', name: 'Geopolitics & defence', status: 'data', news: 'defence',
    description: 'Defence and security headlines, military spending and armed-forces indicators.',
    layers: ['military', 'military-installations'],
    indicators: ['MS.MIL.XPND.GD.ZS', 'MS.MIL.XPND.CD', 'MS.MIL.TOTL.P1'],
  },
  {
    id: 'safety', name: 'Crime & public safety', status: 'data', news: 'publicSafety',
    description: 'Public-safety headlines and the official homicide-rate indicator.',
    indicators: ['VC.IHR.PSRC.P5'],
  },
  {
    id: 'economy', name: 'Economy, markets & commodities', status: 'data', news: 'economy',
    description: 'ECB reference exchange rates (updated each working day) with growth, inflation and unemployment indicators.',
    indicators: ['NY.GDP.MKTP.KD.ZG', 'FP.CPI.TOTL.ZG', 'SL.UEM.TOTL.ZS', 'NY.GDP.MKTP.CD'],
    feeds: ['fx'],
  },
  {
    id: 'business', name: 'Business, trade & industry', status: 'data', news: 'business',
    description: 'Business headlines with trade, investment and industry indicators.',
    indicators: ['NE.EXP.GNFS.ZS', 'NE.IMP.GNFS.ZS', 'BX.KLT.DINV.WD.GD.ZS', 'NV.IND.TOTL.ZS'],
    feeds: ['fx'],
  },
  {
    id: 'health', name: 'Public health & medicine', status: 'data', news: 'health',
    description: 'Health headlines with life expectancy, infant mortality and health-spending indicators.',
    indicators: ['SP.DYN.LE00.IN', 'SP.DYN.IMRT.IN', 'SH.XPD.CHEX.GD.ZS', 'SH.MED.PHYS.ZS'],
  },
  {
    id: 'science', name: 'Science, research & education', status: 'data', news: 'science',
    description: 'Most-cited new research papers this week (OpenAlex), R&D and education indicators.',
    indicators: ['GB.XPD.RSDV.GD.ZS', 'SE.TER.ENRR', 'SE.ADT.LITR.ZS'],
    feeds: ['openalex'],
  },
  {
    id: 'tech', name: 'Technology, AI & cybersecurity', status: 'data', news: 'cybersecurity',
    description: 'Newest entries in the CISA Known Exploited Vulnerabilities catalogue, technology headlines and connectivity indicators.',
    indicators: ['IT.NET.USER.ZS', 'IT.CEL.SETS.P2', 'TX.VAL.TECH.MF.ZS'],
    feeds: ['cisa'],
  },
  {
    id: 'agriculture', name: 'Agriculture, food & water', status: 'data', news: 'agriculture',
    description: 'Food and farming headlines with yield, land-use, undernourishment and water indicators.',
    indicators: ['AG.YLD.CREL.KG', 'AG.LND.AGRI.ZS', 'SN.ITK.DEFC.ZS', 'SH.H2O.BASW.ZS'],
  },
  {
    id: 'population', name: 'Population & demographics', status: 'data', news: 'demographics',
    description: 'Population, growth, urbanisation, age structure and migration indicators.',
    indicators: ['SP.POP.TOTL', 'SP.POP.GROW', 'SP.URB.TOTL.IN.ZS', 'SP.POP.65UP.TO.ZS', 'SM.POP.NETM'],
  },
  {
    id: 'environment', name: 'Environment & biodiversity', status: 'data', news: 'biodiversity',
    description: 'Conservation headlines with forest, protected-area, renewable-energy and air-pollution indicators.',
    layers: ['air-quality', 'local-firms'],
    indicators: ['AG.LND.FRST.ZS', 'ER.PTD.TOTL.ZS', 'EG.FEC.RNEW.ZS', 'EN.ATM.PM25.MC.M3'],
  },
  {
    id: 'travel', name: 'Transport, travel & tourism', status: 'data', news: 'travel',
    description: 'Tourism and travel headlines with visitor-arrival, tourism-receipt and air-passenger indicators.',
    layers: ['flights', 'transit'],
    indicators: ['ST.INT.ARVL', 'ST.INT.RCPT.CD', 'IS.AIR.PSGR'],
  },
  {
    id: 'culture', name: 'Culture, media & entertainment', status: 'data', news: 'entertainment',
    description: 'Film, music, arts and culture headlines from the last 24 hours.',
    indicators: ['IT.NET.USER.ZS'],
  },
  {
    id: 'sports', name: 'Sports & competitions', status: 'data', news: 'sports',
    description: 'Sports headlines and results reporting from the last 24 hours.',
  },
].map((domain) => Object.freeze({ layers: [], indicators: [], feeds: [], ...domain })));

export const DOMAIN_BY_ID = new Map(DOMAINS.map((domain) => [domain.id, domain]));

/** Countries offered in the popup (ISO3 codes the World Bank API accepts). */
export const DOMAIN_COUNTRIES = Object.freeze([
  ['IND', 'India'], ['WLD', 'World'], ['USA', 'United States'], ['CHN', 'China'],
  ['GBR', 'United Kingdom'], ['JPN', 'Japan'], ['DEU', 'Germany'], ['FRA', 'France'],
  ['RUS', 'Russia'], ['BRA', 'Brazil'], ['CAN', 'Canada'], ['AUS', 'Australia'],
  ['PAK', 'Pakistan'], ['BGD', 'Bangladesh'], ['NPL', 'Nepal'], ['LKA', 'Sri Lanka'],
  ['IDN', 'Indonesia'], ['KOR', 'South Korea'], ['SAU', 'Saudi Arabia'], ['ARE', 'United Arab Emirates'],
  ['IRN', 'Iran'], ['ISR', 'Israel'], ['TUR', 'Turkey'], ['EGY', 'Egypt'],
  ['NGA', 'Nigeria'], ['ZAF', 'South Africa'], ['KEN', 'Kenya'], ['MEX', 'Mexico'],
  ['ARG', 'Argentina'], ['ITA', 'Italy'], ['ESP', 'Spain'], ['UKR', 'Ukraine'],
  ['SGP', 'Singapore'], ['MYS', 'Malaysia'], ['THA', 'Thailand'], ['VNM', 'Vietnam'],
]);

export const DOMAIN_COUNTRY_CODES = new Set(DOMAIN_COUNTRIES.map(([code]) => code));
