#!/usr/bin/env node
/**
 * update-cities.mjs
 * cities.json のデータを公的APIから自動更新するスクリプト
 *
 * 使い方:
 *   node scripts/update-cities.mjs [options]
 *
 * Options:
 *   --city=<slug|all>     更新対象エリア (例: --city=shibuya, --city=all)
 *   --fields=<field,...>  更新するフィールド (例: --fields=price,population)
 *                         指定なし = all (price, land, population, yield)
 *   --dry-run             実際にファイルを書き換えずに取得値をプレビュー
 *   --year=<YYYY>         取引価格の対象年 (デフォルト: 前年)
 *   --quarter=<1-4>       取引価格の対象四半期 (デフォルト: 直近)
 *   --help                このヘルプを表示
 *
 * 必要なAPIキー (scripts/.env に設定):
 *   REINFOLIB_API_KEY   国土交通省 不動産情報ライブラリ
 *   ESTAT_APP_ID        e-Stat（総務省統計局）
 *
 * データソース:
 *   price / land     → 国土交通省 不動産情報ライブラリ（XIT001, XPT001）
 *   population       → e-Stat API（住民基本台帳人口移動報告）
 *   yield            → price + rent から計算（avg_rent_man は手動更新）
 *   trend / grade    → 自動取得不可。手動更新（警告を出力）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── パス解決 ──────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'src', 'data', 'cities.json');
const ENV_FILE  = path.join(__dirname, '.env');

// ── .env 読み込み ─────────────────────────────────────────────────
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    console.warn(`[WARN] scripts/.env が見つかりません。scripts/.env.example をコピーして設定してください。`);
    return {};
  }
  const lines = fs.readFileSync(ENV_FILE, 'utf-8').split('\n');
  const env   = {};
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

// ── CLI 引数パース ────────────────────────────────────────────────
function parseArgs() {
  const args   = process.argv.slice(2);
  const opts   = { city: 'all', fields: null, dryRun: false, year: null, quarter: null };
  for (const arg of args) {
    if (arg === '--help')               { printHelp(); process.exit(0); }
    if (arg === '--dry-run')            { opts.dryRun = true; continue; }
    const [k, v] = arg.replace(/^--/, '').split('=');
    if (k === 'city')    opts.city    = v;
    if (k === 'fields')  opts.fields  = v.split(',');
    if (k === 'year')    opts.year    = parseInt(v, 10);
    if (k === 'quarter') opts.quarter = parseInt(v, 10);
  }
  // デフォルト: 前年の Q4
  const now = new Date();
  if (!opts.year)    opts.year    = now.getFullYear() - 1;
  if (!opts.quarter) opts.quarter = 4;
  if (!opts.fields)  opts.fields  = ['price', 'land', 'population', 'yield'];
  return opts;
}

function printHelp() {
  console.log(`
使い方: node scripts/update-cities.mjs [options]

  --city=<slug|all>      更新対象 (例: --city=shibuya)
  --fields=<f1,f2,...>   更新フィールド: price | land | population | yield
  --dry-run              ファイル書き換えなし（プレビューのみ）
  --year=YYYY            取引価格の対象年（デフォルト: 前年）
  --quarter=1-4          四半期（デフォルト: 4）
  --help                 このヘルプ

例:
  node scripts/update-cities.mjs --dry-run
  node scripts/update-cities.mjs --city=shibuya --fields=price,population
  node scripts/update-cities.mjs --year=2024 --quarter=2
`);
}

// ── 市区町村コードマスタ ──────────────────────────────────────────
const CITY_MASTER = {
  shibuya:  { prefCode: '13', cityCode: '13113', cityName: '渋谷区',  estatAreaCode: '13113' },
  minato:   { prefCode: '13', cityCode: '13103', cityName: '港区',    estatAreaCode: '13103' },
  setagaya: { prefCode: '13', cityCode: '13112', cityName: '世田谷区',estatAreaCode: '13112' },
  meguro:   { prefCode: '13', cityCode: '13110', cityName: '目黒区',  estatAreaCode: '13110' },
  shinjuku: { prefCode: '13', cityCode: '13104', cityName: '新宿区',  estatAreaCode: '13104' },
};

// ── HTTP ヘルパー ──────────────────────────────────────────────────
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} - ${url}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════════════
// 1. 国土交通省 不動産情報ライブラリ API
//    ドキュメント: https://www.reinfolib.mlit.go.jp/help/apiManual/
// ══════════════════════════════════════════════════════════════════

const REINFOLIB_BASE = 'https://www.reinfolib.mlit.go.jp/ex-api/external';

/**
 * 中古マンション等の成約価格を取得し、区内の中央値を返す（万円）
 * エンドポイント: XIT001（不動産取引価格情報取得）
 * land_type=3: 中古マンション等
 */
async function fetchAvgPrice(apiKey, cityMeta, year, quarter) {
  const params = new URLSearchParams({
    year:      String(year),
    quarter:   String(quarter),
    area:      cityMeta.prefCode,
    city:      cityMeta.cityCode,
    land_type: '3',            // 中古マンション等
  });
  const url  = `${REINFOLIB_BASE}/XIT001?${params}`;
  const json = await getJson(url, { 'Ocp-Apim-Subscription-Key': apiKey });

  const items = json?.data ?? [];
  if (items.length === 0) {
    console.warn(`  [WARN] ${cityMeta.cityName}: 取引データが0件 (year=${year} q=${quarter})`);
    return null;
  }

  // 取引価格（円）→ 万円に変換し中央値を算出
  const prices = items
    .map(d => parseInt(d.TradePrice ?? '0', 10))
    .filter(p => p > 0)
    .sort((a, b) => a - b);

  const mid    = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0
    ? (prices[mid - 1] + prices[mid]) / 2
    : prices[mid];

  console.log(`  取引件数: ${prices.length}件 / 中央値: ${Math.round(median / 10000).toLocaleString('ja-JP')}万円`);
  return Math.round(median / 10000);
}

/**
 * 地価公示の住宅地平均価格を取得（万円/㎡）
 * エンドポイント: XPT001（地価公示・地価調査）
 */
async function fetchLandPrice(apiKey, cityMeta, year) {
  const params = new URLSearchParams({
    year:      String(year),
    area:      cityMeta.prefCode,
    city:      cityMeta.cityCode,
    use:       '住宅地',
  });
  const url  = `${REINFOLIB_BASE}/XPT001?${params}`;
  const json = await getJson(url, { 'Ocp-Apim-Subscription-Key': apiKey });

  const items = json?.data ?? [];
  if (items.length === 0) {
    console.warn(`  [WARN] ${cityMeta.cityName}: 地価公示データが0件 (year=${year})`);
    return null;
  }

  // 価格（円/㎡）→ 万円/㎡に変換して平均
  const prices = items
    .map(d => parseInt(d.Price ?? '0', 10))
    .filter(p => p > 0);

  const avg = prices.reduce((s, v) => s + v, 0) / prices.length;
  console.log(`  地価標準地: ${prices.length}地点 / 平均: ${Math.round(avg / 10000).toLocaleString('ja-JP')}万円/㎡`);
  return Math.round(avg / 10000);
}

// ══════════════════════════════════════════════════════════════════
// 2. e-Stat API（総務省統計局）
//    ドキュメント: https://www.e-stat.go.jp/api/api-info/e-stat-manual3-0
//    使用統計: 住民基本台帳に基づく人口・世帯数（統計表ID: 0000020201）
// ══════════════════════════════════════════════════════════════════

const ESTAT_BASE      = 'https://api.e-stat.go.jp/rest/3.0/app/json';
// 住民基本台帳人口移動報告（市区町村別）の統計表ID
// 参照: https://www.e-stat.go.jp/stat-search/files?stat_infid=000040115615
const ESTAT_STATS_ID  = '0000020201';

/**
 * 市区町村の人口・世帯数を e-Stat API から取得
 * 返り値: { population: number, households: number } | null
 */
async function fetchPopulation(appId, cityMeta) {
  // まず統計表のメタ情報（cat01等のコード）を取得
  const metaUrl = `${ESTAT_BASE}/getMetaInfo?appId=${appId}&statsDataId=${ESTAT_STATS_ID}&lang=J`;
  let meta;
  try {
    meta = await getJson(metaUrl);
  } catch (e) {
    console.warn(`  [WARN] e-Stat メタ情報取得失敗: ${e.message}`);
    return null;
  }

  // 市区町村コードに対応するクラスコードを探す
  const classInfos = meta?.GET_META_INFO?.METADATA_INF?.CLASS_INF?.CLASS_OBJ ?? [];
  const areaClass  = classInfos.find(c => c['@id'] === 'area');
  if (!areaClass) {
    console.warn(`  [WARN] e-Stat: area クラスが見つかりません`);
    return null;
  }

  // 市区町村コードは5桁（e-Statでは先頭に都道府県コードが含まれる場合あり）
  const areaCode5 = cityMeta.estatAreaCode;
  const areaItems = Array.isArray(areaClass.CLASS) ? areaClass.CLASS : [areaClass.CLASS];
  const areaItem  = areaItems.find(c => c['@code'] === areaCode5);
  if (!areaItem) {
    console.warn(`  [WARN] e-Stat: ${cityMeta.cityName} (${areaCode5}) の地域コードが見つかりません`);
    return null;
  }

  // 人口・世帯数データを取得
  const dataUrl = `${ESTAT_BASE}/getStatsData?appId=${appId}&statsDataId=${ESTAT_STATS_ID}&cdArea=${areaCode5}&lang=J&metaGetFlg=N&cntGetFlg=N`;
  let data;
  try {
    data = await getJson(dataUrl);
  } catch (e) {
    console.warn(`  [WARN] e-Stat データ取得失敗: ${e.message}`);
    return null;
  }

  const values = data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE ?? [];
  const arr    = Array.isArray(values) ? values : [values];

  // 「総人口」「総世帯数」に相当する値を探す
  // cat01コードは統計表により異なるため、@cat01 の内容で判別
  let population  = null;
  let households  = null;
  for (const v of arr) {
    const label = v['@cat01'] ?? '';
    if (/総人口|人口計/.test(label) && population  === null) population  = parseInt(v['$'], 10);
    if (/総世帯数|世帯数計/.test(label) && households === null) households = parseInt(v['$'], 10);
  }

  if (population !== null) {
    console.log(`  人口: ${population.toLocaleString('ja-JP')}人 / 世帯数: ${households?.toLocaleString('ja-JP') ?? '不明'}世帯`);
  } else {
    console.warn(`  [WARN] ${cityMeta.cityName}: 人口データが見つかりませんでした`);
  }

  return population !== null ? { population, households } : null;
}

// ══════════════════════════════════════════════════════════════════
// 3. 利回り計算（price + rent から算出）
// ══════════════════════════════════════════════════════════════════

/**
 * avg_rent_man（月額・万円）と avg_price_man から表面利回りを計算
 *
 * ⚠️ 注意: avg_price_man が「区全体の中古マンション中央値」である場合、
 *   大型物件が含まれ avg_rent_man（想定1室賃料）との単位が揃わない。
 *   その場合は yield フィールドを --fields から除外し、手動で管理すること。
 *
 *   yield 自動計算が有効なのは、avg_price_man と avg_rent_man が
 *   「同一グレード・同一専有面積の物件」を想定して揃っている場合のみ。
 */
function calcYield(priceMen, rentMen) {
  if (!priceMen || !rentMen) return null;
  return Math.round((rentMen * 12 / priceMen) * 1000) / 10; // 小数点1位
}

// ══════════════════════════════════════════════════════════════════
// メイン処理
// ══════════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();
  const env  = loadEnv();

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  update-cities.mjs');
  console.log(`  year=${opts.year} q=${opts.quarter} dry-run=${opts.dryRun}`);
  console.log(`  fields: ${opts.fields.join(', ')}`);
  console.log('══════════════════════════════════════════');
  console.log('');

  // APIキー確認
  const reinfKey = env.REINFOLIB_API_KEY;
  const estatId  = env.ESTAT_APP_ID;

  const needsReinf = opts.fields.some(f => ['price', 'land'].includes(f));
  const needsEstat = opts.fields.includes('population');

  if (needsReinf && (!reinfKey || reinfKey.includes('your_'))) {
    console.error('[ERROR] REINFOLIB_API_KEY が未設定です。scripts/.env を確認してください。');
    if (!opts.dryRun) process.exit(1);
  }
  if (needsEstat && (!estatId || estatId.includes('your_'))) {
    console.error('[ERROR] ESTAT_APP_ID が未設定です。scripts/.env を確認してください。');
    if (!opts.dryRun) process.exit(1);
  }

  // cities.json 読み込み
  const cities = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

  // 対象エリアを絞り込む
  const targets = opts.city === 'all'
    ? cities
    : cities.filter(c => c.slug === opts.city);

  if (targets.length === 0) {
    console.error(`[ERROR] slug="${opts.city}" に一致するエリアが cities.json に見つかりません。`);
    process.exit(1);
  }

  // 手動更新が必要なフィールドの警告
  const manualFields = ['avg_rent_man', 'price_trend_1y_pct', 'rent_trend_1y_pct', 'investment_grade', 'liquidity', 'vacancy_rate_pct', 'cap_rate_pct'];
  console.log('⚠️  以下のフィールドは自動取得不可のため、手動更新が必要です:');
  console.log(`   ${manualFields.join(', ')}`);
  console.log(`   参照: src/data/cities.schema.md`);
  console.log('');

  // 各エリアを処理
  const results = [];
  for (const city of targets) {
    const meta = CITY_MASTER[city.slug];
    if (!meta) {
      console.warn(`[SKIP] slug="${city.slug}" は CITY_MASTER に未定義です。scripts/update-cities.mjs に追加してください。`);
      continue;
    }

    console.log(`▶ ${city.name} (${city.slug})`);
    const updates = {};

    // ── 価格取得 ──────────────────────────────────────────────────
    if (opts.fields.includes('price') && reinfKey && !reinfKey.includes('your_')) {
      console.log('  [price] 不動産取引価格情報取得中...');
      try {
        const price = await fetchAvgPrice(reinfKey, meta, opts.year, opts.quarter);
        if (price !== null) updates.avg_price_man = price;
      } catch (e) {
        console.warn(`  [WARN] price 取得失敗: ${e.message}`);
      }
    }

    // ── 地価取得 ──────────────────────────────────────────────────
    if (opts.fields.includes('land') && reinfKey && !reinfKey.includes('your_')) {
      console.log('  [land] 地価公示取得中...');
      try {
        const land = await fetchLandPrice(reinfKey, meta, opts.year);
        if (land !== null) updates.land_price_man_per_m2 = land;
      } catch (e) {
        console.warn(`  [WARN] land 取得失敗: ${e.message}`);
      }
    }

    // ── 人口取得 ──────────────────────────────────────────────────
    if (opts.fields.includes('population') && estatId && !estatId.includes('your_')) {
      console.log('  [population] e-Stat 人口データ取得中...');
      try {
        const pop = await fetchPopulation(estatId, meta);
        if (pop) {
          if (pop.population)  updates.population  = pop.population;
          if (pop.households)  updates.households  = pop.households;
        }
      } catch (e) {
        console.warn(`  [WARN] population 取得失敗: ${e.message}`);
      }
    }

    // ── 利回り再計算 ──────────────────────────────────────────────
    if (opts.fields.includes('yield')) {
      const price = updates.avg_price_man ?? city.avg_price_man;
      const rent  = city.avg_rent_man; // rentは手動フィールドのため既存値を使用
      const y     = calcYield(price, rent);
      if (y !== null) {
        const existing = city.avg_yield_pct;
        const diff     = Math.abs(y - existing);
        if (diff > 1.0) {
          // 既存値と1pt以上乖離する場合は自動上書きせず警告のみ
          console.warn(`  [WARN] yield計算値 ${y}% が既存値 ${existing}% と大きく乖離しています（差: ${diff.toFixed(1)}pt）`);
          console.warn(`         avg_price_man と avg_rent_man の想定単位が揃っているか確認してください。`);
          console.warn(`         自動上書きをスキップします。手動で avg_yield_pct を更新してください。`);
        } else {
          updates.avg_yield_pct = y;
          updates.cap_rate_pct  = y; // cap_rate は avg_yield と同値で仮置き（手動調整推奨）
          console.log(`  [yield] ${rent}万円 × 12 / ${price}万円 = ${y}% (既存: ${existing}%)`);
        }
      }
    }

    results.push({ city, updates });
    console.log(`  取得結果: ${Object.keys(updates).length === 0 ? '変更なし' : JSON.stringify(updates)}`);
    console.log('');
  }

  // ── dry-run / 書き込み ────────────────────────────────────────
  if (opts.dryRun) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('DRY-RUN: 以下の変更が適用されます（ファイルは書き換えていません）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const { city, updates } of results) {
      if (Object.keys(updates).length === 0) continue;
      console.log(`\n  ${city.name}:`);
      for (const [k, v] of Object.entries(updates)) {
        console.log(`    ${k}: ${city[k]} → ${v}`);
      }
    }
    console.log('');
    return;
  }

  // 実際に書き込む
  let changed = false;
  for (const { city, updates } of results) {
    if (Object.keys(updates).length === 0) continue;
    const idx = cities.findIndex(c => c.slug === city.slug);
    if (idx === -1) continue;
    Object.assign(cities[idx], updates);
    changed = true;
  }

  if (changed) {
    // 更新日時をファイルの先頭コメントとして記録するためにカスタムシリアライズ
    const timestamp  = new Date().toISOString().slice(0, 10);
    const jsonOutput = JSON.stringify(cities, null, 2);
    fs.writeFileSync(DATA_FILE, jsonOutput, 'utf-8');
    console.log(`✅ cities.json を更新しました（${timestamp}）`);
    console.log(`   対象: ${results.filter(r => Object.keys(r.updates).length > 0).map(r => r.city.name).join(', ')}`);
  } else {
    console.log('ℹ️  変更はありませんでした。');
  }

  // ── 更新ログをファイルに保存 ──────────────────────────────────
  const logDir  = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
  const logFile = path.join(logDir, `update-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  const logData = {
    timestamp: new Date().toISOString(),
    year:      opts.year,
    quarter:   opts.quarter,
    fields:    opts.fields,
    results:   results.map(r => ({ slug: r.city.slug, name: r.city.name, updates: r.updates })),
  };
  fs.writeFileSync(logFile, JSON.stringify(logData, null, 2), 'utf-8');
  console.log(`📋 更新ログ: ${path.relative(ROOT, logFile)}`);
}

main().catch(e => {
  console.error('\n[FATAL]', e.message);
  process.exit(1);
});
