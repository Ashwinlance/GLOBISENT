/**
 * GLOBISENT News Desk client for the GDELT DOC 2.0 public article index.
 * Headlines and links remain attributed to their original publishers; GLOBISENT
 * does not republish full article text.
 */
export const NEWS_CATEGORIES = Object.freeze({
  all: {
    label: 'All available topics',
    query: '(election OR government OR parliament OR economy OR business OR conflict OR diplomacy OR technology OR science OR health OR climate OR earthquake OR flood OR sports OR education OR transport OR energy OR agriculture OR entertainment OR cybersecurity OR tourism OR crime OR demographics OR commodities OR biodiversity)',
  },
  world: { label: 'World', query: '(world OR international OR diplomacy OR summit OR government)' },
  politics: { label: 'Politics & policy', query: '(election OR parliament OR government OR diplomacy OR legislation OR policy)' },
  government: { label: 'Government & public policy', query: '(government OR public policy OR parliament OR legislation OR ministry OR regulator)' },
  defence: { label: 'Defence & security', query: '(defence OR defense OR military OR security OR arms OR navy OR air force)' },
  economy: { label: 'Economy & finance', query: '(economy OR inflation OR interest rates OR central bank OR trade OR markets OR currency)' },
  business: { label: 'Business & industry', query: '(business OR company OR industry OR startup OR manufacturing OR investment)' },
  technology: { label: 'Technology & AI', query: '(technology OR artificial intelligence OR software OR robotics OR semiconductor OR innovation)' },
  cybersecurity: { label: 'Cybersecurity', query: '(cybersecurity OR cyber attack OR data breach OR vulnerability OR ransomware OR information security)' },
  science: { label: 'Science & research', query: '(science OR research OR discovery OR physics OR biology OR chemistry OR laboratory)' },
  space: { label: 'Space & astronomy', query: '(space OR satellite OR astronomy OR NASA OR ISRO OR rocket OR launch)' },
  health: { label: 'Health & medicine', query: '(public health OR disease OR healthcare OR medicine OR medical research OR outbreak)' },
  climate: { label: 'Climate & environment', query: '(climate OR environment OR pollution OR conservation OR emissions)' },
  biodiversity: { label: 'Biodiversity & wildlife', query: '(biodiversity OR wildlife OR conservation OR species OR habitat OR ecosystem)' },
  disasters: { label: 'Disasters & emergencies', query: '(earthquake OR flood OR cyclone OR hurricane OR wildfire OR volcano OR disaster)' },
  sports: { label: 'Sports', query: '(sports OR football OR cricket OR tennis OR athletics OR Olympics)' },
  education: { label: 'Education', query: '(education OR university OR school OR student OR research funding)' },
  transport: { label: 'Transport & infrastructure', query: '(aviation OR airline OR airport OR shipping OR railway OR port OR infrastructure)' },
  energy: { label: 'Energy & resources', query: '(energy OR electricity OR power grid OR oil OR gas OR renewable energy OR mining)' },
  agriculture: { label: 'Agriculture & food', query: '(agriculture OR farming OR crop OR food security OR fisheries OR food prices)' },
  commodities: { label: 'Commodities & resources', query: '(commodities OR crude oil OR natural gas OR gold price OR metals OR mining OR resources)' },
  publicSafety: { label: 'Crime & public safety', query: '(crime OR public safety OR police OR court OR emergency services OR investigation)' },
  demographics: { label: 'Demographics & society', query: '(demographics OR population OR census OR migration OR social trends OR urbanisation)' },
  travel: { label: 'Travel & tourism', query: '(travel OR tourism OR hotels OR destinations OR visitor arrivals OR tourism industry)' },
  entertainment: { label: 'Culture & entertainment', query: '(film OR cinema OR music OR entertainment OR arts OR culture)' },
});

const GDELT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

function safeSearchPhrase(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\r\n\t]/g, ' ')
    .replace(/["\\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s.,'&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}

/** Build a constrained GDELT search URL. Region=India means coverage about India, not only Indian publishers. */
export function buildNewsUrl({ category = 'all', region = 'global', search = '' } = {}) {
  const selected = NEWS_CATEGORIES[category] ?? NEWS_CATEGORIES.all;
  const parts = [selected.query];
  if (region === 'india') parts.push('India');
  const phrase = safeSearchPhrase(search);
  if (phrase) parts.push(`"${phrase}"`);

  const url = new URL(GDELT_ENDPOINT);
  url.searchParams.set('query', parts.join(' '));
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', '75');
  url.searchParams.set('timespan', '1d');
  url.searchParams.set('sort', 'datedesc');
  return url.toString();
}

function parseSeenDate(value) {
  const raw = String(value ?? '').trim();
  const match = /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/.exec(raw);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Normalize GDELT article rows into a small, safe UI model. */
export function normalizeNewsResponse(payload) {
  const articles = Array.isArray(payload?.articles) ? payload.articles : [];
  const seen = new Set();
  const normalized = [];

  for (const article of articles) {
    const url = safeHttpUrl(article?.url);
    const title = String(article?.title ?? '').trim();
    if (!url || !title) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      title: title.slice(0, 320),
      url,
      source: String(article?.domain ?? new URL(url).hostname).slice(0, 120),
      sourceCountry: String(article?.sourcecountry ?? '').slice(0, 80),
      language: String(article?.language ?? '').slice(0, 40),
      publishedAt: parseSeenDate(article?.seendate),
      image: safeHttpUrl(article?.socialimage),
    });
  }

  return normalized;
}
