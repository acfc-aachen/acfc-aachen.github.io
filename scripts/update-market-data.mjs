import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'src', 'data', 'market-watch.json');
const fetchedAt = new Date().toISOString();
const cnnEndpoint = process.env.CNN_FEAR_GREED_URL || 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const cnnSourceUrl = 'https://www.cnn.com/markets/fear-and-greed';
const eurostatBase = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
const gdpUrl = `${eurostatBase}/namq_10_gdp?lang=en&geo=EA21&na_item=B1GQ&unit=CLV_PCH_PRE&s_adj=SCA&lastTimePeriod=8`;
const inflationUrl = `${eurostatBase}/prc_hicp_minr?lang=en&geo=EA21&coicop18=TOTAL&unit=RCH_A&lastTimePeriod=18`;
const execFileAsync = promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const cleanRating = (value = '') => String(value).trim().toLowerCase().replaceAll('_', ' ');
const rounded = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : null;
const rounded2 = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) / 100 : null;
const rounded4 = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 10_000) / 10_000 : null;
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

const fetchShillerCape = async () => {
  const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const script = path.join(root, 'scripts', 'read-shiller.py');
  const { stdout } = await execFileAsync(python, [script], { timeout: 60_000, maxBuffer: 2_000_000 });
  return { ...JSON.parse(stdout), fetchedAt };
};

const fetchConstituents = async () => {
  const url = 'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_S%26P_500_companies&prop=text&format=json&origin=*';
  const raw = await requestJson(url, { headers: { 'user-agent': 'ACFC-Market-Watch/1.0 (aachen_acfc@126.com)' } });
  const html = raw?.parse?.text?.['*'] ?? '';
  const table = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/i)?.[0] ?? '';
  const symbols = [...table.matchAll(/<tr[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, '').replaceAll('&amp;', '&').replaceAll('&#160;', '').trim())
    .filter((symbol) => /^[A-Z.]{1,6}$/.test(symbol));
  const unique = [...new Set(symbols)];
  if (unique.length < 490) throw new Error(`Only ${unique.length} S&P 500 symbols were parsed`);
  return unique;
};

const fetchYahooChart = async (symbol, range = '6mo') => {
  const yahooSymbol = symbol.replaceAll('.', '-');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=1d&events=history`;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await requestJson(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ACFC-Market-Watch/1.0)' } });
      const result = raw?.chart?.result?.[0];
      if (!result?.timestamp?.length) throw new Error(`No chart data for ${symbol}`);
      return { symbol, timestamps: result.timestamp, closes: result.indicators?.quote?.[0]?.close ?? [] };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await delay(350 * (attempt + 1));
    }
  }
  throw lastError;
};

const fetchGoldDebtRatio = async () => {
  const startDate = new Date();
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 5);
  const start = startDate.toISOString().slice(0, 10);
  const treasuryEndpoint = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&filter=record_date:gte:${start}&sort=record_date&page[size]=10000`;
  const [goldChart, debtRaw] = await Promise.all([
    fetchYahooChart('GC=F', '5y'),
    requestJson(treasuryEndpoint, { headers: { accept: 'application/json', 'user-agent': 'ACFC-Market-Watch/1.0 (aachen_acfc@126.com)' } }),
  ]);
  const debts = (debtRaw?.data ?? [])
    .map((row) => ({ date: row.record_date, value: Number(row.tot_pub_debt_out_amt) }))
    .filter((point) => point.date && Number.isFinite(point.value) && point.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!debts.length) throw new Error('Treasury response did not include total public debt observations');

  let debtIndex = 0;
  const matched = [];
  for (let index = 0; index < goldChart.timestamps.length; index += 1) {
    const goldPrice = Number(goldChart.closes[index]);
    if (!Number.isFinite(goldPrice) || goldPrice <= 0) continue;
    const date = new Date(goldChart.timestamps[index] * 1000).toISOString().slice(0, 10);
    while (debtIndex + 1 < debts.length && debts[debtIndex + 1].date <= date) debtIndex += 1;
    const debt = debts[debtIndex];
    if (!debt || debt.date > date) continue;
    const debtTrillions = debt.value / 1e12;
    matched.push({ date, debtDate: debt.date, goldPrice: rounded2(goldPrice), debtTrillions: rounded2(debtTrillions), ratio: rounded2(goldPrice / debtTrillions) });
  }
  if (!matched.length) throw new Error('Gold and Treasury observations could not be aligned');
  const monthly = [...matched.reduce((months, point) => months.set(point.date.slice(0, 7), point), new Map()).values()];
  const history = monthly.slice(-60);
  const latest = matched.at(-1);
  const oneYearReference = history.find((point) => point.date >= `${Number(latest.date.slice(0, 4)) - 1}-${latest.date.slice(5, 7)}`) ?? history[0];
  return {
    available: true, stale: false, fetchedAt,
    source: 'Calculated from COMEX gold futures and U.S. Treasury total public debt outstanding',
    goldSourceUrl: 'https://finance.yahoo.com/quote/GC=F/history/',
    debtSourceUrl: 'https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/',
    unit: 'USD/oz per USD 1tn debt',
    ...latest,
    oneYearChange: oneYearReference ? rounded2((latest.ratio / oneYearReference.ratio - 1) * 100) : null,
    history,
  };
};

const fetchEurUsd = async () => {
  const chart = await fetchYahooChart('EURUSD=X', '1y');
  const history = chart.timestamps.map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    value: rounded4(chart.closes[index]),
  })).filter((point) => point.value !== null && point.value > 0).slice(-260);
  const latest = history.at(-1);
  const previous = history.at(-2);
  const first = history[0];
  if (!latest || !previous || !first) throw new Error('EUR/USD chart did not include enough observations');
  return {
    available: true, stale: false, fetchedAt,
    source: 'Yahoo Finance delayed daily EUR/USD closes',
    sourceUrl: 'https://finance.yahoo.com/quote/EURUSD%3DX/history/',
    date: latest.date,
    value: latest.value,
    dailyChange: rounded2((latest.value / previous.value - 1) * 100),
    oneYearChange: rounded2((latest.value / first.value - 1) * 100),
    yearHigh: rounded4(Math.max(...history.map((point) => point.value))),
    yearLow: rounded4(Math.min(...history.map((point) => point.value))),
    history,
  };
};

const fetchBreadth = async () => {
  const symbols = await fetchConstituents();
  const charts = [];
  let cursor = 0;
  const workers = Array.from({ length: 10 }, async () => {
    while (cursor < symbols.length) {
      const index = cursor;
      cursor += 1;
      try { charts.push(await fetchYahooChart(symbols[index])); } catch {}
    }
  });
  await Promise.all(workers);
  if (charts.length < 450) throw new Error(`Yahoo returned only ${charts.length} of ${symbols.length} constituent histories`);

  const daily = new Map();
  for (const chart of charts) {
    for (let index = 1; index < chart.timestamps.length; index += 1) {
      const previousClose = Number(chart.closes[index - 1]);
      const close = Number(chart.closes[index]);
      if (!Number.isFinite(previousClose) || !Number.isFinite(close)) continue;
      const date = new Date(chart.timestamps[index] * 1000).toISOString().slice(0, 10);
      const point = daily.get(date) ?? { date, advancers: 0, decliners: 0, unchanged: 0, coverage: 0 };
      const difference = close - previousClose;
      if (difference > 0.000001) point.advancers += 1;
      else if (difference < -0.000001) point.decliners += 1;
      else point.unchanged += 1;
      point.coverage += 1;
      daily.set(date, point);
    }
  }

  const indexChart = await fetchYahooChart('^GSPC');
  const indexReturns = new Map();
  for (let index = 1; index < indexChart.timestamps.length; index += 1) {
    const previousClose = Number(indexChart.closes[index - 1]);
    const close = Number(indexChart.closes[index]);
    if (!Number.isFinite(previousClose) || !Number.isFinite(close)) continue;
    const date = new Date(indexChart.timestamps[index] * 1000).toISOString().slice(0, 10);
    indexReturns.set(date, rounded2((close / previousClose - 1) * 100));
  }

  const minimumCoverage = Math.max(430, Math.floor(charts.length * 0.9));
  const history = [...daily.values()]
    .filter((point) => point.coverage >= minimumCoverage)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((point) => ({
      ...point,
      score: rounded((point.advancers + point.unchanged * 0.5) / point.coverage * 100),
      netBreadth: rounded((point.advancers - point.decliners) / point.coverage * 100),
      sp500Change: indexReturns.get(point.date) ?? null,
    }))
    .slice(-90);
  const latest = history.at(-1);
  if (!latest) throw new Error('No complete market-breadth session was produced');
  return {
    available: true, stale: false, fetchedAt, source: 'Calculated from S&P 500 constituents and delayed daily closes',
    constituentsSourceUrl: 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies',
    pricesSourceUrl: 'https://finance.yahoo.com/quote/%5EGSPC/history/',
    date: latest.date, constituentCount: symbols.length, successfulSymbols: charts.length,
    ...latest, history,
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

let shillerCape;
try {
  shillerCape = await fetchShillerCape();
  console.log(`Updated Shiller CAPE: ${shillerCape.value} (${shillerCape.period})`);
} catch (error) {
  shillerCape = preserve(previous.shillerCape, 'Robert J. Shiller, Yale University', error);
  console.warn(`Shiller CAPE update unavailable; preserved fallback: ${shillerCape.lastError}`);
}

let breadth;
try {
  breadth = await fetchBreadth();
  console.log(`Updated S&P 500 breadth: ${breadth.advancers} up / ${breadth.decliners} down (${breadth.date}, ${breadth.coverage} covered)`);
} catch (error) {
  breadth = preserve(previous.breadth, 'S&P 500 constituents / Yahoo Finance delayed data', error);
  console.warn(`Breadth update unavailable; preserved fallback: ${breadth.lastError}`);
}

let goldDebt;
try {
  goldDebt = await fetchGoldDebtRatio();
  console.log(`Updated gold/debt ratio: ${goldDebt.ratio} (${goldDebt.date}, gold ${goldDebt.goldPrice}, debt ${goldDebt.debtTrillions}tn)`);
} catch (error) {
  goldDebt = preserve(previous.goldDebt, 'COMEX gold futures / U.S. Treasury Fiscal Data', error);
  console.warn(`Gold/debt ratio update unavailable; preserved fallback: ${goldDebt.lastError}`);
}

let eurUsd;
try {
  eurUsd = await fetchEurUsd();
  console.log(`Updated EUR/USD: ${eurUsd.value} (${eurUsd.date}, ${eurUsd.dailyChange}% daily)`);
} catch (error) {
  eurUsd = preserve(previous.eurUsd, 'Yahoo Finance delayed EUR/USD data', error);
  console.warn(`EUR/USD update unavailable; preserved fallback: ${eurUsd.lastError}`);
}

await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt: fetchedAt, cnn, macro, shillerCape, breadth, goldDebt, eurUsd }, null, 2)}\n`, 'utf8');
