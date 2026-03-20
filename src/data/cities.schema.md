# cities.json スキーマ定義・参照元

## ⚠️ データの性質について

**現在の値はすべて「参考概算値」です。**
公式統計・不動産ポータルから手動で確認・入力することを推奨します。
掲載データは実際の市場と乖離する可能性があるため、定期的な見直しが必要です。

---

## フィールド定義

### 識別・基本情報

| フィールド | 型 | 説明 | 推奨参照元 |
|---|---|---|---|
| `slug` | string | URLスラッグ（英数字・ハイフン） | 独自定義 |
| `name` | string | 地域名（例: 渋谷区） | 独自定義 |
| `prefecture` | string | 都道府県名 | 独自定義 |
| `region` | string | 広域区分の表示ラベル（例: 東京23区） | 独自定義 |
| `description` | string | ページ概要文・meta descriptionにも使用 | 編集者作成 |

---

### 人口・地理統計

| フィールド | 型 | 単位 | 説明 | 推奨参照元 |
|---|---|---|---|---|
| `population` | number | 人 | 推計人口 | [総務省 住民基本台帳人口](https://www.soumu.go.jp/main_sosiki/jichi_gyousei/daityo/jinkou_jinkodoutai.html) / 各区市の統計ページ |
| `households` | number | 世帯 | 総世帯数 | 同上 |
| `area_km2` | number | km² | 行政面積 | [国土地理院 全国都道府県市区町村別面積調](https://www.gsi.go.jp/KOKUJYOHO/MENCHO-title.htm) |

---

### 不動産価格・賃料

| フィールド | 型 | 単位 | 説明 | 推奨参照元 |
|---|---|---|---|---|
| `avg_price_man` | number | 万円 | 区内マンション（中古含む）の成約価格の中央値目安 | [東日本不動産流通機構（レインズ）月次マーケットウォッチ](https://www.reins.or.jp/market/index.html) / [不動産情報ライブラリ（国土交通省）](https://www.reinfolib.mlit.go.jp/) |
| `avg_rent_man` | number | 万円/月 | ワンルーム〜1LDK の平均賃料の目安（管理費別） | [SUUMO賃貸データ](https://suumo.jp/) / [homes.co.jp 賃料相場](https://www.homes.co.jp/) / [at home賃貸相場](https://www.athome.co.jp/) |
| `land_price_man_per_m2` | number | 万円/㎡ | 路線価・公示地価の平均的目安（住宅地） | [国税庁 路線価図](https://www.rosenka.nta.go.jp/) / [国土交通省 地価公示](https://www.land.mlit.go.jp/landPrice/AriaServlet) |

---

### 利回り・収益指標

| フィールド | 型 | 単位 | 説明・計算方法 | 推奨参照元 |
|---|---|---|---|---|
| `avg_yield_pct` | number | % | 表面利回りの区内平均目安。`avg_rent_man × 12 / avg_price_man × 100` の近似値 | [不動産投資ローン・利回り動向（健美家）](https://www.kenbiya.com/ar/ns/research/) / [楽待 不動産投資新聞](https://www.rakumachi.jp/news/) |
| `cap_rate_pct` | number | % | 還元利回り（Cap Rate）。実質利回りに近い概念。`avg_yield_pct` との差分が運営費率の目安 | 上記に同じ。一般的に表面より0.5〜1.5pt低い |
| `vacancy_rate_pct` | number | % | エリアの賃貸空室率概算 | [総務省 住宅・土地統計調査（5年毎）](https://www.stat.go.jp/data/jyutaku/) / [LIFULL HOME'S 空室率レポート](https://www.homes.co.jp/) |

---

### 市場トレンド

| フィールド | 型 | 単位 | 説明 | 推奨参照元 |
|---|---|---|---|---|
| `price_trend_1y_pct` | number | % | 直近1年の物件価格変動率（前年同期比） | [東京カンテイ マンション市場動向](https://www.kantei.ne.jp/) / レインズ月次統計 |
| `rent_trend_1y_pct` | number | % | 直近1年の賃料変動率（前年同期比） | SUUMO・homes賃料動向レポート |

---

### 投資評価（編集者判断）

| フィールド | 型 | 説明 | 設定基準の目安 |
|---|---|---|---|
| `investment_grade` | string | 投資魅力度グレード（`A+` / `A` / `A-` / `B+` / `B` / `B-`） | **A+**: 流動性高・需要超旺盛・価格上昇トレンド継続中。**A**: 安定需要・流動性高。**B+**: 利回り確保しやすいが流動性やや低め。独自判断のため根拠を明示すること。 |
| `liquidity` | string | 市場流動性の定性評価（`高` / `中` / `低`） | 成約日数・売出数・回転率などを参考に独自判断 |

---

### 駅情報

```json
"stations": [
  {
    "name": "渋谷",           // 駅名（路線図・時刻表と一致させること）
    "lines": ["JR山手線"],    // 乗入路線（正式名称）
    "avg_price_man": 14200    // 駅徒歩10分圏内のマンション平均成約価格目安（万円）
  }
]
```

**参照元**: 国土交通省 不動産情報ライブラリ（駅距離別成約データ）/ SUUMO・homes の駅別価格

---

### 周辺エリア

```json
"nearby_areas": [
  {
    "slug": "minato",         // 対応する cities.json の slug（リンク生成に使用）
    "name": "港区",           // 表示名
    "avg_price_man": 16800,   // 当エリアの avg_price_man と同一ルールで入力
    "avg_yield_pct": 3.2      // 当エリアの avg_yield_pct と同一ルールで入力
  }
]
```

> `slug` が cities.json に存在しないエリアはリンク先が 404 になるため注意。

---

### FAQ・投資ポイント

```json
"faq": [
  { "q": "質問文", "a": "回答文" }   // JSON-LD FAQPage にも出力される。SEO上は独自性ある内容を
],
"investment_points": [
  {
    "icon": "📈",             // 絵文字アイコン
    "title": "見出し",        // 20文字以内推奨
    "body": "本文"            // 80文字以内推奨
  }
]
```

---

## データ更新頻度の推奨

| カテゴリ | 推奨更新頻度 |
|---|---|
| `population` / `households` | 年1回（住民基本台帳 1月1日時点が最新） |
| `avg_price_man` / `avg_rent_man` / `avg_yield_pct` | 四半期ごと（レインズ・SUUMO等の公開レポート反映時） |
| `price_trend_1y_pct` / `rent_trend_1y_pct` | 四半期ごと |
| `land_price_man_per_m2` | 年1回（地価公示は3月下旬発表） |
| `vacancy_rate_pct` | 住宅土地統計調査が5年毎のため、中間年は業界レポートで補完 |
| `investment_grade` / `liquidity` | 市況変化時に随時見直し |

---

## 主要参照元URL一覧

| 参照元 | URL | 内容 |
|---|---|---|
| 国土交通省 不動産情報ライブラリ | https://www.reinfolib.mlit.go.jp/ | 実際の成約価格（実勢価格）の検索・ダウンロード |
| 東日本不動産流通機構（レインズ）| https://www.reins.or.jp/market/ | 月次・四半期市場データ（マンション・戸建・土地） |
| 国土交通省 地価公示 | https://www.land.mlit.go.jp/landPrice/ | 標準地の公示地価（毎年3月下旬更新） |
| 国税庁 路線価図 | https://www.rosenka.nta.go.jp/ | 相続税・贈与税の基準となる路線価（毎年7月更新） |
| 総務省 住民基本台帳 | https://www.soumu.go.jp/main_sosiki/jichi_gyousei/daityo/ | 市区町村別人口・世帯数（毎年1月1日時点） |
| 総務省 住宅・土地統計調査 | https://www.stat.go.jp/data/jyutaku/ | 空室率・住宅ストック（5年毎） |
| 東京カンテイ | https://www.kantei.ne.jp/ | マンション価格トレンドレポート（有料・一部無料） |
| 健美家 投資用不動産市場動向 | https://www.kenbiya.com/ar/ns/research/ | 投資用物件の利回り動向（四半期公開） |
