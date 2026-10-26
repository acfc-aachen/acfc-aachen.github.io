import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'src', 'data', 'market-watch.json');
const endpoint = process.env.CNN_FEAR_GREED_URL || 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const sourceUrl = 'https://www.cnn.com/markets/fear-and-greed';
const fetchedAt = new Date().toISOString();

const cleanRating = (value = '') => String(value).trim().toLowerCase().replaceAll('_', ' ');
const score = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : null;
const toIso = (value, fallback = fetchedAt) => {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : value);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });

try {
  const response = await fetch(endpoint, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: sourceUrl,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`CNN endpoint returned HTTP ${response.status}`);

  const raw = await response.json();
  const headline = raw.fear_and_greed ?? {};
  const history = (raw.fear_and_greed_historical?.data ?? [])
    .map((point) => ({ date: toIso(point.x), value: score(point.y), rating: cleanRating(point.rating) }))
    .filter((point) => point.value !== null)
    .slice(-120);
  const componentKeys = [
    'market_momentum_sp500', 'stock_price_strength', 'stock_price_breadth',
    'put_call_options', 'market_volatility_vix', 'junk_bond_demand', 'safe_haven_demand',
  ];

  const output = {
    available: score(headline.score) !== null,
    stale: false,
    source: 'CNN Fear & Greed Index',
    sourceUrl,
    fetchedAt,
    asOf: toIso(headline.timestamp),
    score: score(headline.score),
    rating: cleanRating(headline.rating),
    previousClose: score(headline.previous_close),
    previousWeek: score(headline.previous_1_week),
    previousMonth: score(headline.previous_1_month),
    previousYear: score(headline.previous_1_year),
    history,
    components: componentKeys.map((key) => ({
      key,
      score: score(raw[key]?.score),
      rating: cleanRating(raw[key]?.rating),
    })).filter((item) => item.score !== null),
  };

  if (!output.available) throw new Error('CNN response did not include a headline score');
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Updated CNN Fear & Greed: ${output.score} (${output.rating}), ${history.length} history points`);
} catch (error) {
  let fallback = null;
  try { fallback = JSON.parse(await fs.readFile(outputPath, 'utf8')); } catch {}
  const output = fallback ? { ...fallback, stale: true, lastAttemptAt: fetchedAt, lastError: String(error.message ?? error) } : {
    available: false, stale: true, source: 'CNN Fear & Greed Index', sourceUrl,
    fetchedAt: null, asOf: null, score: null, rating: '', history: [], components: [],
    lastAttemptAt: fetchedAt, lastError: String(error.message ?? error),
  };
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.warn(`CNN Fear & Greed update unavailable; preserved fallback data: ${output.lastError}`);
}
