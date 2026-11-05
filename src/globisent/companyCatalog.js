/**
 * GLOBISENT company catalog: major companies in every sector, keyed by their
 * English Wikipedia article title (resolved to Wikidata on the server) and a
 * Yahoo Finance ticker for listed companies (null for private ones).
 * Any other company can still be found through the COMPANIES search box.
 */

export const COMPANY_SECTORS = Object.freeze([
  { id: 'tech', name: 'Technology & internet', color: '#35c9f2' },
  { id: 'semis', name: 'Semiconductors & hardware', color: '#7aa8ff' },
  { id: 'software', name: 'Software & IT services', color: '#5fd4ff' },
  { id: 'security', name: 'Cybersecurity', color: '#b28cff' },
  { id: 'finance', name: 'Banking, finance & insurance', color: '#ffd166' },
  { id: 'energy', name: 'Oil, gas & energy', color: '#ff9f43' },
  { id: 'renewables', name: 'Renewables & utilities', color: '#5ef0a3' },
  { id: 'auto', name: 'Automotive & EV', color: '#ff6a78' },
  { id: 'aerospace', name: 'Aerospace & defence', color: '#c0c8d0' },
  { id: 'space', name: 'Space industry', color: '#a0e7ff' },
  { id: 'pharma', name: 'Pharma & healthcare', color: '#ff8fc7' },
  { id: 'consumer', name: 'Retail & consumer goods', color: '#ffb86b' },
  { id: 'food', name: 'Food, beverage & agriculture', color: '#9be15d' },
  { id: 'telecom', name: 'Telecom & networking', color: '#6ee7d8' },
  { id: 'media', name: 'Media, entertainment & gaming', color: '#f78fb3' },
  { id: 'logistics', name: 'Shipping, logistics & airlines', color: '#4fc3f7' },
  { id: 'travel', name: 'Hotels & travel', color: '#ffcf8a' },
  { id: 'materials', name: 'Mining, metals & materials', color: '#d4a373' },
  { id: 'industrial', name: 'Industrial & engineering', color: '#b5c99a' },
  { id: 'conglomerate', name: 'Conglomerates', color: '#e9c46a' },
]);

export const SECTOR_BY_ID = new Map(COMPANY_SECTORS.map((s) => [s.id, s]));

// [Wikipedia title, Yahoo ticker | null]
const RAW = {
  tech: [
    ['Apple Inc.', 'AAPL'], ['Microsoft', 'MSFT'], ['Alphabet Inc.', 'GOOGL'], ['Amazon (company)', 'AMZN'],
    ['Meta Platforms', 'META'], ['Samsung Electronics', '005930.KS'], ['Sony', 'SONY'], ['Tencent', '0700.HK'],
    ['Alibaba Group', 'BABA'], ['ByteDance', null], ['Baidu', 'BIDU'], ['Xiaomi', '1810.HK'], ['Uber', 'UBER'],
    ['OpenAI', null], ['Flipkart', null], ['Shopify', 'SHOP'], ['Dell Technologies', 'DELL'], ['Lenovo', '0992.HK'],
  ],
  semis: [
    ['Nvidia', 'NVDA'], ['TSMC', 'TSM'], ['Intel', 'INTC'], ['AMD', 'AMD'], ['Qualcomm', 'QCOM'],
    ['Broadcom', 'AVGO'], ['ASML Holding', 'ASML'], ['Texas Instruments', 'TXN'], ['Micron Technology', 'MU'],
    ['SK Hynix', '000660.KS'], ['Arm Holdings', 'ARM'], ['Applied Materials', 'AMAT'], ['Foxconn', '2317.TW'],
  ],
  software: [
    ['Oracle Corporation', 'ORCL'], ['Salesforce', 'CRM'], ['SAP', 'SAP'], ['Adobe Inc.', 'ADBE'], ['IBM', 'IBM'],
    ['Tata Consultancy Services', 'TCS.NS'], ['Infosys', 'INFY.NS'], ['Wipro', 'WIPRO.NS'], ['HCLTech', 'HCLTECH.NS'],
    ['Tech Mahindra', 'TECHM.NS'], ['Accenture', 'ACN'], ['ServiceNow', 'NOW'], ['Palantir Technologies', 'PLTR'],
    ['Zoho Corporation', null],
  ],
  security: [
    ['CrowdStrike', 'CRWD'], ['Palo Alto Networks', 'PANW'], ['Fortinet', 'FTNT'], ['Check Point', 'CHKP'],
    ['Zscaler', 'ZS'], ['Okta, Inc.', 'OKTA'], ['Cloudflare', 'NET'], ['Kaspersky Lab', null],
  ],
  finance: [
    ['JPMorgan Chase', 'JPM'], ['Bank of America', 'BAC'], ['Goldman Sachs', 'GS'], ['Morgan Stanley', 'MS'],
    ['HSBC', 'HSBA.L'], ['Industrial and Commercial Bank of China', '1398.HK'], ['Visa Inc.', 'V'], ['Mastercard', 'MA'],
    ['BlackRock', 'BLK'], ['Berkshire Hathaway', 'BRK-B'], ['HDFC Bank', 'HDFCBANK.NS'], ['State Bank of India', 'SBIN.NS'],
    ['ICICI Bank', 'ICICIBANK.NS'], ['Mitsubishi UFJ Financial Group', '8306.T'], ['PayPal', 'PYPL'],
    ['Bajaj Finance', 'BAJFINANCE.NS'], ['Life Insurance Corporation', 'LICI.NS'], ['Allianz', 'ALV.DE'], ['UBS', 'UBSG.SW'],
  ],
  energy: [
    ['ExxonMobil', 'XOM'], ['Chevron Corporation', 'CVX'], ['Shell plc', 'SHEL'], ['BP', 'BP'], ['TotalEnergies', 'TTE'],
    ['Saudi Aramco', '2222.SR'], ['PetroChina', '0857.HK'], ['Oil and Natural Gas Corporation', 'ONGC.NS'],
    ['Indian Oil Corporation', 'IOC.NS'], ['ConocoPhillips', 'COP'], ['Equinor', 'EQNR'], ['Gazprom', null], ['Petrobras', 'PBR'],
  ],
  renewables: [
    ['NextEra Energy', 'NEE'], ['Iberdrola', 'IBE.MC'], ['Ørsted (company)', 'ORSTED.CO'], ['Enel', 'ENEL.MI'],
    ['Vestas', 'VWS.CO'], ['First Solar', 'FSLR'], ['Adani Green Energy', 'ADANIGREEN.NS'], ['NTPC Limited', 'NTPC.NS'],
    ['Tata Power', 'TATAPOWER.NS'], ['Duke Energy', 'DUK'], ['Siemens Energy', 'ENR.DE'], ['Enphase Energy', 'ENPH'],
    ['Contemporary Amperex Technology', '300750.SZ'],
  ],
  auto: [
    ['Tesla, Inc.', 'TSLA'], ['Toyota', '7203.T'], ['Volkswagen Group', 'VOW3.DE'], ['BYD Company', '1211.HK'],
    ['Mercedes-Benz Group', 'MBG.DE'], ['BMW', 'BMW.DE'], ['Ford Motor Company', 'F'], ['General Motors', 'GM'],
    ['Honda', '7267.T'], ['Hyundai Motor Company', '005380.KS'], ['Tata Motors', null], ['Mahindra & Mahindra', 'M&M.NS'],
    ['Maruti Suzuki', 'MARUTI.NS'], ['Stellantis', 'STLA'], ['Ferrari', 'RACE'], ['Rivian', 'RIVN'], ['Ola Electric', 'OLAELEC.NS'],
  ],
  aerospace: [
    ['Boeing', 'BA'], ['Airbus', 'AIR.PA'], ['Lockheed Martin', 'LMT'], ['RTX Corporation', 'RTX'], ['Northrop Grumman', 'NOC'],
    ['General Dynamics', 'GD'], ['BAE Systems', 'BA.L'], ['Thales Group', 'HO.PA'], ['Rheinmetall', 'RHM.DE'],
    ['Hindustan Aeronautics Limited', 'HAL.NS'], ['Bharat Electronics', 'BEL.NS'], ['Leonardo S.p.A.', 'LDO.MI'],
    ['Safran', 'SAF.PA'], ['Dassault Aviation', 'AM.PA'], ['Embraer', 'EMBJ'], ['GE Aerospace', 'GE'],
  ],
  space: [
    ['SpaceX', null], ['Blue Origin', null], ['Rocket Lab', 'RKLB'], ['Arianespace', null], ['United Launch Alliance', null],
    ['Planet Labs', 'PL'], ['Maxar Technologies', null], ['Skyroot Aerospace', null], ['AST SpaceMobile', 'ASTS'],
    ['Iridium Communications', 'IRDM'], ['SES S.A.', 'SESG.PA'], ['Eutelsat', 'ETL.PA'],
  ],
  pharma: [
    ['Johnson & Johnson', 'JNJ'], ['Pfizer', 'PFE'], ['Eli Lilly and Company', 'LLY'], ['Novo Nordisk', 'NVO'],
    ['Roche', 'ROG.SW'], ['Novartis', 'NOVN.SW'], ['Merck & Co.', 'MRK'], ['AstraZeneca', 'AZN'], ['AbbVie', 'ABBV'],
    ['Sanofi', 'SAN.PA'], ['Bayer', 'BAYN.DE'], ['Sun Pharmaceutical', 'SUNPHARMA.NS'], ["Dr. Reddy's Laboratories", 'DRREDDY.NS'],
    ['Cipla', 'CIPLA.NS'], ['Serum Institute of India', null], ['UnitedHealth Group', 'UNH'], ['Moderna', 'MRNA'],
    ['Apollo Hospitals', 'APOLLOHOSP.NS'],
  ],
  consumer: [
    ['Walmart', 'WMT'], ['Costco', 'COST'], ['Procter & Gamble', 'PG'], ['Nike, Inc.', 'NKE'], ['Adidas', 'ADS.DE'],
    ['LVMH', 'MC.PA'], ["L'Oréal", 'OR.PA'], ['Unilever', 'ULVR.L'], ['Hindustan Unilever', 'HINDUNILVR.NS'],
    ['The Home Depot', 'HD'], ['IKEA', null], ['Inditex', 'ITX.MC'], ['Titan Company', 'TITAN.NS'],
    ['Asian Paints', 'ASIANPAINT.NS'], ['Puma (brand)', 'PUM.DE'], ['Avenue Supermarts', 'DMART.NS'],
  ],
  food: [
    ['Nestlé', 'NESN.SW'], ['PepsiCo', 'PEP'], ['The Coca-Cola Company', 'KO'], ["McDonald's", 'MCD'], ['Starbucks', 'SBUX'],
    ['Danone', 'BN.PA'], ['Mondelez International', 'MDLZ'], ['Cargill', null], ['Archer-Daniels-Midland', 'ADM'],
    ['Deere & Company', 'DE'], ['Tata Consumer Products', 'TATACONSUM.NS'], ['ITC Limited', 'ITC.NS'], ['Amul', null],
    ['Britannia Industries', 'BRITANNIA.NS'], ['Nutrien', 'NTR'], ['AB InBev', 'ABI.BR'],
  ],
  telecom: [
    ['AT&T', 'T'], ['Verizon', 'VZ'], ['T-Mobile US', 'TMUS'], ['China Mobile', '0941.HK'], ['Vodafone', 'VOD.L'],
    ['Deutsche Telekom', 'DTE.DE'], ['Bharti Airtel', 'BHARTIARTL.NS'], ['Jio Platforms', null],
    ['Nippon Telegraph and Telephone', '9432.T'], ['Orange S.A.', 'ORA.PA'], ['Nokia', 'NOKIA.HE'], ['Ericsson', 'ERIC-B.ST'],
    ['Huawei', null], ['Cisco', 'CSCO'],
  ],
  media: [
    ['The Walt Disney Company', 'DIS'], ['Netflix', 'NFLX'], ['Comcast', 'CMCSA'], ['Warner Bros. Discovery', 'WBD'],
    ['Spotify', 'SPOT'], ['Universal Music Group', 'UMG.AS'], ['Nintendo', '7974.T'], ['Electronic Arts', 'EA'],
    ['Zee Entertainment Enterprises', 'ZEEL.NS'], ['PVR INOX', 'PVRINOX.NS'], ['Bertelsmann', null],
    ['Live Nation Entertainment', 'LYV'], ['Roblox Corporation', 'RBLX'], ['Krafton', '259960.KS'],
  ],
  logistics: [
    ['Maersk', 'MAERSK-B.CO'], ['Mediterranean Shipping Company', null], ['CMA CGM', null], ['FedEx', 'FDX'],
    ['United Parcel Service', 'UPS'], ['DHL Group', 'DHL.DE'], ['Delta Air Lines', 'DAL'], ['Emirates (airline)', null],
    ['IndiGo', 'INDIGO.NS'], ['Air India', null], ['Lufthansa', 'LHA.DE'], ['Singapore Airlines', 'C6L.SI'],
    ['Union Pacific Corporation', 'UNP'], ['Adani Ports & SEZ', 'ADANIPORTS.NS'], ['Hapag-Lloyd', 'HLAG.DE'],
  ],
  travel: [
    ['Marriott International', 'MAR'], ['Hilton Worldwide', 'HLT'], ['Booking Holdings', 'BKNG'], ['Airbnb', 'ABNB'],
    ['Expedia Group', 'EXPE'], ['InterContinental Hotels Group', 'IHG'], ['Accor', 'AC.PA'], ['Indian Hotels Company Limited', 'INDHOTEL.NS'],
    ['MakeMyTrip', 'MMYT'], ['Trip.com Group', 'TCOM'], ['Royal Caribbean Group', 'RCL'], ['Carnival Corporation & plc', 'CCL'],
  ],
  materials: [
    ['BHP', 'BHP'], ['Rio Tinto (corporation)', 'RIO'], ['Vale (company)', 'VALE'], ['Glencore', 'GLEN.L'], ['ArcelorMittal', 'MT'],
    ['Tata Steel', 'TATASTEEL.NS'], ['JSW Steel', 'JSWSTEEL.NS'], ['Nippon Steel', '5401.T'], ['Freeport-McMoRan', 'FCX'],
    ['Anglo American plc', 'AAL.L'], ['Hindalco Industries', 'HINDALCO.NS'], ['Coal India', 'COALINDIA.NS'], ['BASF', 'BAS.DE'],
    ['Dow Inc.', 'DOW'], ['UltraTech Cement', 'ULTRACEMCO.NS'], ['Albemarle Corporation', 'ALB'],
  ],
  industrial: [
    ['Siemens', 'SIE.DE'], ['Caterpillar Inc.', 'CAT'], ['Honeywell', 'HON'], ['3M', 'MMM'], ['ABB', 'ABBN.SW'],
    ['Schneider Electric', 'SU.PA'], ['Larsen & Toubro', 'LT.NS'], ['Mitsubishi Heavy Industries', '7011.T'],
    ['Hitachi', '6501.T'], ['Robert Bosch GmbH', null], ['Bharat Heavy Electricals', 'BHEL.NS'], ['Komatsu Limited', '6301.T'],
  ],
  conglomerate: [
    ['Tata Group', null], ['Reliance Industries', 'RELIANCE.NS'], ['Adani Group', null], ['Aditya Birla Group', null],
    ['Mahindra Group', null], ['Samsung', null], ['Mitsubishi', null], ['Berkshire Hathaway', 'BRK-B'],
    ['Adani Enterprises', 'ADANIENT.NS'], ['Hanwha', null], ['Jardine Matheson', 'J36.SI'],
  ],
};

/** Flat list: { title, ticker, sector }. A company may appear in two sectors. */
export const COMPANY_CATALOG = Object.freeze(
  Object.entries(RAW).flatMap(([sector, rows]) => rows.map(([title, ticker]) => Object.freeze({ title, ticker, sector }))),
);

/** Which company sectors each GLOBISENT domain popup lists. */
export const DOMAIN_COMPANY_SECTORS = Object.freeze({
  aviation: ['aerospace', 'logistics'],
  maritime: ['logistics'],
  space: ['space', 'aerospace'],
  weather: ['renewables'],
  mobility: ['auto', 'logistics'],
  infrastructure: ['industrial', 'energy', 'renewables', 'telecom'],
  news: ['media'],
  geopolitics: ['aerospace'],
  safety: ['security'],
  economy: ['finance', 'energy', 'materials'],
  business: ['conglomerate', 'tech', 'consumer', 'industrial'],
  health: ['pharma'],
  science: ['pharma', 'semis', 'space'],
  tech: ['tech', 'semis', 'software', 'security'],
  agriculture: ['food'],
  environment: ['renewables'],
  travel: ['travel', 'logistics'],
  culture: ['media'],
  sports: ['media', 'consumer'],
});
