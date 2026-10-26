import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'src', 'data', 'market-watch.json');
const fetchedAt = new Date().toISOString();
const cnnEndpoint = process.env.CNN_FEAR_GREED_URL || 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const cnnSourceUrl = 'https://www.cnn.com/markets/fear-and-greed';
const eurostatBase = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
const gdpUrl = `${eurostatBase}/namq_10_gdp?lang=en&geo=EA21&na_item=B1GQ&unit=CLV_PCH_PRE&s_adj=SCA&lastTimePeriod=8`;
const inflationUrl = `${eurostatBase}/prc_hicp_minr?lang=en&geo=EA21&coicop18=TOTAL&unit=RCH_A&lastTimePeriod=18`;

const cleanRating = (value = '') => String(value).trim().toLowerCase().replaceAll('_', ' ');
const rounded = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : null;
const toIso = (value, fallback = fetchedAt) => {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : value);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
};
const errorText = (error) => String(error?.message ?? error);
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  return response.json();
};
const jsonStatSeries = (dataset) => {
  const positions = Object.entries(dataset?.dimension?.time?.category?.index ?? {})
    .sort(([, a], [, b]) => Number(a) - Number(b));
  return positions.map(([period, position]) => ({ period, value: rounded(dataset.value?.[position]) }))
    .filter((point) => point.value !== null);
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
let previous = {};
try { previous = JSON.parse(await fs.readFile(outputPath, 'utf8')); } catch {}
const previousCnn = previous.cnn ?? (previous.source === 'CNN Fear & Greed Index' ? previous : null);

const fetchCnn = async () => {
  const raw = await requestJson(cnnEndpoint, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: cnnSourceUrl,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    },
  });
  const headline = raw.fear_and_greed ?? {};
  const score = rounded(headline.score);
  if (score === null) throw new Error('CNN response did not include a headline score');
  return {
    available: true, stale: false, source: 'CNN Fear & Greed Index', sourceUrl: cnnSourceUrl,
    fetchedAt, asOf: toIso(headline.timestamp), score, rating: cleanRating(headline.rating),
    previousClose: rounded(headline.previous_close), previousWeek: rounded(headline.previous_1_week),
    previousMonth: rounded(headline.previous_1_month), previousYear: rounded(headline.previous_1_year),
    history: (raw.fear_and_greed_historical?.data ?? [])
      .map((point) => ({ date: toIso(point.x), value: rounded(point.y), rating: cleanRating(point.rating) }))
      .filter((point) => point.value !== null).slice(-120),
  };
};

const fetchMacro = async () => {
  const [gdpData, inflationData] = await Promise.all([
    requestJson(gdpUrl, { headers: { accept: 'application/json' } }),
    requestJson(inflationUrl, { headers: { accept: 'application/json' } }),
  ]);
  const growthHistory = jsonStatSeries(gdpData);
  const inflationHistory = jsonStatSeries(inflationData);
  const growth = growthHistory.at(-1);
  const inflation = inflationHistory.at(-1);
  if (!growth || !inflation) throw new Error('Eurostat response did not include both GDP and HICP observations');
  return {
    available: true, stale: false, source: 'Eurostat',
    sourceUrl: 'https://ec.europa.eu/eurostat/databrowser/view/namq_10_gdp/default/table',
    inflationSourceUrl: 'https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table',
    fetchedAt, region: 'EA21', regionName: 'Euro area – 21 countries',
    growth: { ...growth, unit: '% q/q', series: 'namq_10_gdp', updatedAt: gdpData.updated ?? null },
    inflation: { ...inflation, unit: '% y/y', series: 'prc_hicp_minr', updatedAt: inflationData.updated ?? null },
    growthHistory, inflationHistory,
  };
};

const preserve = (fallback, label, error) => fallback
  ? { ...fallback, stale: true, lastAttemptAt: fetchedAt, lastError: errorText(error) }
  : { available: false, stale: true, source: label, fetchedAt: null, lastAttemptAt: fetchedAt, lastError: errorText(error) };

let cnn;
try {
  cnn = await fetchCnn();
  console.log(`Updated CNN Fear & Greed: ${cnn.score} (${cnn.rating})`);
} catch (error) {
  cnn = preserve(previousCnn, 'CNN Fear & Greed Index', error);
  console.warn(`CNN update unavailable; preserved fallback: ${cnn.lastError}`);
}

let macro;
try {
  macro = await fetchMacro();
  console.log(`Updated Eurostat macro: GDP ${macro.growth.value}% (${macro.growth.period}), HICP ${macro.inflation.value}% (${macro.inflation.period})`);
} catch (error) {
  macro = preserve(previous.macro, 'Eurostat', error);
  console.warn(`Eurostat update unavailable; preserved fallback: ${macro.lastError}`);
}

await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt: fetchedAt, cnn, macro }, null, 2)}\n`, 'utf8');
