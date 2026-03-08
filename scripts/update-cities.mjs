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
 *                         指定なし = all (price, land, population, grade)
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
 *   price      → 国土交通省 不動産情報ライブラリ XIT001（中古マンション成約価格中央値）
 *   land       → 国土交通省 不動産情報ライブラリ XPT001（住宅地地価公示平均）
 *   population → e-Stat API（住民基本台帳人口・世帯数）
 *   grade      → land_price + population_density から自動算出（編集者による上書き可）
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
  if (!opts.fields)  opts.fields  = ['price', 'land', 'population', 'grade'];
  return opts;
}

function printHelp() {
  console.log(`
使い方: node scripts/update-cities.mjs [options]

  --city=<slug|all>      更新対象 (例: --city=shibuya)
  --fields=<f1,f2,...>   更新フィールド: price | land | population | grade
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
// 3. 投資グレード・流動性の自動算出
//    使用データ（いずれも本スクリプトで自動取得可能）:
//      land_price_man_per_m2 → 国土交通省 地価公示（XPT001）
//      population_density    → population（e-Stat）÷ area_km2（静的値）
// ══════════════════════════════════════════════════════════════════

/**
 * 地価と人口密度からスコアを算出し investment_grade を返す
 *
 * スコア = 地価スコア（0〜5）+ 密度スコア（0〜2）
 *   地価（万円/㎡）: >=200→5, >=150→4, >=100→3, >=60→2, >=35→1, else→0
 *   人口密度（人/km²）: >=18000→2, >=12000→1, else→0
 *
 * グレード: >=6→A+, >=5→A, >=4→A-, >=3→B+, else→B
 */
function deriveGrade(landPrice, population, areaKm2) {
  let score = 0;

  // 地価スコア
  if      (landPrice >= 200) score += 5;
  else if (landPrice >= 150) score += 4;
  else if (landPrice >= 100) score += 3;
  else if (landPrice >= 60)  score += 2;
  else if (landPrice >= 35)  score += 1;

  // 人口密度スコア
  const density = population / areaKm2;
  if      (density >= 18000) score += 2;
  else if (density >= 12000) score += 1;

  if      (score >= 6) return 'A+';
  else if (score >= 5) return 'A';
  else if (score >= 4) return 'A-';
  else if (score >= 3) return 'B+';
  return 'B';
}

/** investment_grade から流動性を返す */
function deriveLiquidity(grade) {
  if (['A+', 'A', 'A-'].includes(grade)) return '高';
  if (['B+'].includes(grade))             return '中';
  return '低';
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

  console.log('ℹ️  price / land / population は grade 算出の中間値として使用し、cities.json には書き込みません。');
  console.log('   cities.json に書き込まれるのは investment_grade と liquidity のみです。');
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

    // ── 中間値（grade 算出用・JSON に書き込まない） ───────────────
    let fetchedLand = null;
    let fetchedPop  = null;

    if (opts.fields.includes('price') && reinfKey && !reinfKey.includes('your_')) {
      console.log('  [price] 不動産取引価格情報取得中（grade算出用）...');
      try {
        await fetchAvgPrice(reinfKey, meta, opts.year, opts.quarter);
        // 取得値は grade 算出の参考ログ用。cities.json には書き込まない。
      } catch (e) {
        console.warn(`  [WARN] price 取得失敗: ${e.message}`);
      }
    }

    if (opts.fields.includes('land') && reinfKey && !reinfKey.includes('your_')) {
      console.log('  [land] 地価公示取得中（grade算出用）...');
      try {
        fetchedLand = await fetchLandPrice(reinfKey, meta, opts.year);
      } catch (e) {
        console.warn(`  [WARN] land 取得失敗: ${e.message}`);
      }
    }

    if (opts.fields.includes('population') && estatId && !estatId.includes('your_')) {
      console.log('  [population] e-Stat 人口データ取得中（grade算出用）...');
      try {
        const pop = await fetchPopulation(estatId, meta);
        if (pop?.population) fetchedPop = pop.population;
      } catch (e) {
        console.warn(`  [WARN] population 取得失敗: ${e.message}`);
      }
    }

    // ── 投資グレード・流動性の算出（cities.json に書き込む唯一の値） ──
    if (opts.fields.includes('grade')) {
      // APIから取得できた値を優先し、取得できなければ area_km2 のみ使用
      const land     = fetchedLand ?? null;
      const pop      = fetchedPop  ?? null;
      const area     = city.area_km2;

      if (land !== null && pop !== null) {
        const newGrade = deriveGrade(land, pop, area);
        const newLiq   = deriveLiquidity(newGrade);
        const density  = Math.round(pop / area);
        console.log(`  [grade] 地価${land}万円/㎡ + 人口密度${density}人/km² → ${newGrade} / 流動性: ${newLiq} (既存: ${city.investment_grade})`);
        updates.investment_grade = newGrade;
        updates.liquidity        = newLiq;
      } else {
        console.warn(`  [WARN] grade 算出に必要な land または population が取得できませんでした。既存値を維持します。`);
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
