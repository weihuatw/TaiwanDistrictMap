# 原住民人口地圖：規劃與執行記錄

規劃／來源查核／實作日期：2026-10-12。專案基準 commit：`7325ebb`。此文件保留產品、資料與技術決策；執行狀態已於下方更新。未發布或推送。

## 1. 已決定的產品範圍

新增第七個獨立主題 `#/indigenous`，介面標題「原住民人口地圖」，導覽沿用全臺 → 縣市 → 鄉鎮市區 → 村里。保留灰色鄰區切換、搜尋、分享、返回視角、跨主題位置延續與手機底部面板。

提供兩個有 label 的原生下拉選單：

| 選單 | 值 | 預設 |
| --- | --- | --- |
| 地圖指標 | `population`＝人口數；`share`＝人口比例 | 人口數 |
| 族群 | `all`＝所有族群；其餘由當期 manifest 的族別登錄產生 | 所有族群 |

**比例統一定義為「所選族群人數 ÷ 同地區、同月份總戶籍人口 × 100%」。** 所有族群模式使用官方原住民總計；單一族群模式使用該族男女合計。選單、資訊卡與圖例使用「占總戶籍人口」文字，避免誤解為族群占原住民人口的構成比。上層先加總分子、分母再計算，不能平均村里百分比。

資訊卡在兩種指標下都顯示：地區、所選族群、人數、占總戶籍人口比例、總戶籍人口分母、統計年月。所有族群模式另顯示原住民男性／女性與「尚未申報族別」人數；單族模式另顯示所有族群總數。尚未申報不是一個族，第一版不放入族群選單，但納入所有族群總計。

本期只做一個固定月快照，採 **11508／2026-08**，與專案既有人口快照一致。官方目錄已有 11509 項目，第一版仍不自動追最新月份；後續更新需同時取得完整的族別資料與同月人口分母。

第一版不加歷史年月播放、部落位置／傳統領域、人口密度、身分別篩選或行政區主題資訊卡；上述項目可另立需求。資料表示戶籍登記統計，不代表實際居住分布，也不能由族別欄位推導法律認定狀態。

## 2. 已查核的官方來源與下載格式

| 用途 | 來源／取得方式 | 決定 |
| --- | --- | --- |
| 各村里原住民總數、各族男女數 | 戶政司[現住原住民人口按性別、身分、原住民族別分（新增區域代碼）](https://data.gov.tw/dataset/77052)，`ODRP018` | 主要分子來源 |
| 同月份所有戶籍人口 | 專案已建置的 [ODRP014 村里戶數、單一年齡人口](https://data.gov.tw/dataset/77132)，`public/data/population/2026-08/` | 建置時取總人口，不下載年齡分片 |
| 官方行政區界線 | 專案現有 `public/data/counties.geojson`、`towns/`、`villages/` | 直接沿用，不重建 |
| 交叉參考 | 原民會[鄉鎮市區按性別族別資料](https://data.cip.gov.tw/Home/DataInfo.aspx?BackURL=DataMenu.aspx&funno=110049) | 非主要輸入；只能比較相同月份／定義，不能混補村里 |
| 新增欄位中文名稱參考 | 臺南市[115 年同類官方資料欄位](https://data.tainan.gov.tw/DataSet/Detail/bd469c3a-2e61-47d7-9d9a-d5089d55b360) | 僅核對欄位名稱，不以地方資料取代全國資料 |

已實際下載並解析下面四頁，回傳是 **JSON，不是 CSV**：

```text
https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP018/11508?PAGE=1
https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP018/11508?PAGE=2
https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP018/11508?PAGE=3
https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP018/11508?PAGE=4
```

回應包含 `responseCode`、`totalPage`、`totalDataSize`、`page`、`pageDataSize`、`responseData`。11508 共 4 頁，各頁 2,000／2,000／2,000／1,781 筆；只拿第一頁會漏掉大部分資料。JSON 欄位名稱是英文，數值是字串。不要直接照抄目前 `scripts/population/fetch.py` 的 CSV 假設；分頁流程可參考 `scripts/population/annual_fetch.py` 的 `fetch_table()`，但新管線要獨立保存來源。

### 2.1 完整 11508 資料核對結果

以下是本次四頁實際回應的加總與既有公開資料對照，供初次建置核對；不是未來月份固定常數。

| 檢查 | 結果 |
| --- | ---: |
| 村里列／唯一 11 碼代碼 | 7,781／7,781 |
| 每列欄位數 | 162 |
| 縣市／鄉鎮 | 22／368 |
| 原住民總計 | 639,340 人 |
| 男／女 | 309,210／330,130 人 |
| 平地／山地／平埔身分合計 | 298,724／340,576／40 人 |
| 尚未申報族別 | 7,688 人 |
| 原住民總數明列為 0 的村里 | 251 |
| 具名界線未對應 | 0 |
| 來源有資料、主圖層無界線 | 1：`10013280006` 瑪家鄉三和村 |
| 按代碼相符、村里名稱不同 | 23 |
| 同月公開村里人口分母缺漏 | 0 |
| 原住民總數大於同村總人口 | 0 |
| 各族含尚未申報加總不等於官方總計 | 0 |
| 三種身分合計不等於官方總計 | 0 |
| 原住民總計男女不合 | 0 |

同月全臺總戶籍人口為 23,224,721 人，取自現有公開人口快照。未編定 polygon 不與村里列連接；不能因此填 0。三和村必須納入鄉鎮／縣市／全臺的分子及分母，不能因缺圖形刪掉。

### 2.2 族別登錄：必須依實際欄位，不能固定為 16 族

資料集目錄列出的欄位較舊；11508 API 的總欄實際包含 **26 組族別＋尚未申報**。其中西拉雅族全國有 40 人，其他九組新增族別當期明列為 0。下拉選單應呈現當期資料支援的所有族別，不能只呈現有正數者。這是資料欄位清單，不是法定民族認定清單。

將下表寫成 `data/indigenous/tribes.json`，包含 `id`、`label`、`sourceStem`、`sourceLabel`，必要時附名稱註記與來源；在 manifest 發布當期 `supportedTribes`。`id` 採官方英文 stem，避免 URL 與欄位轉換多一層。

| id／sourceStem | 顯示族名 | 11508 全國人數 |
| --- | --- | ---: |
| `amis` | 阿美族 | 238,319 |
| `atayal` | 泰雅族 | 104,205 |
| `paiwan` | 排灣族 | 116,171 |
| `bunun` | 布農族 | 66,476 |
| `rukai` | 魯凱族 | 14,707 |
| `pinuyumayan` | 卑南族 | 16,822 |
| `cou` | 鄒族 | 7,069 |
| `saisiyat` | 賽夏族 | 7,842 |
| `yami` | 達悟族（官方欄名：雅美族） | 5,132 |
| `thao` | 邵族 | 978 |
| `kavalan` | 噶瑪蘭族 | 1,803 |
| `truku` | 太魯閣族 | 37,526 |
| `sakizaya` | 撒奇萊雅族 | 1,242 |
| `sediq` | 賽德克族 | 12,295 |
| `hlaalua` | 拉阿魯哇族 | 530 |
| `kanakanavu` | 卡那卡那富族 | 495 |
| `siraya` | 西拉雅族 | 40 |
| `ketagalan` | 凱達格蘭族 | 0 |
| `taokas` | 道卡斯族 | 0 |
| `pazeh` | 巴宰族 | 0 |
| `papora` | 拍瀑拉族 | 0 |
| `babuza` | 巴布薩族 | 0 |
| `hoanya` | 洪雅族 | 0 |
| `kaxabu` | 噶哈巫族 | 0 |
| `taivoan` | 大武壠族 | 0 |
| `makatau` | 馬卡道族 | 0 |

`undeclared` 單獨保存為尚未申報。顯示 0 的族群須註明「本期官方戶籍統計為 0，不代表實際族群人口不存在」。若未來某月根本沒有該族欄位，該月不列為支援，不能將欄位缺失轉成 0。任何陌生總族別欄位都要使建置失敗並報告，核對登錄後再更新，不能靜默忽略。

## 3. 正規化與品質規則

1. 統計年月全列必須相同且等於要求的民國五碼年月；另轉成西元 `period` 與月底標準日。
2. `district_code` 嚴格保留字串、前導零，驗證 11 碼；前 8 碼是鄉鎮、前 5 碼是縣市。重複列即失敗，不以最後一筆蓋掉。
3. 名稱只供展示、稽核。按代碼與界線連接；保留 `sourceName`／`boundaryName` 差異報告，不用模糊配對。空白／BOM／NFKC 可用於欄位或名稱稽核，不改行政代碼；欄位 alias 必須明列，禁止任意猜測。
4. 原住民總數取 `indigenous_total`；男女取 `indigenous_total_m/f`；單族取 `indigenous_<stem>_m + indigenous_<stem>_f`。尚未申報取 `indigenous_undeclared_m/f`。
5. **不能再把 `indigenous_plain_*`、`indigenous_mountain_*`、`indigenous_pingpu_*` 加到 `indigenous_*` 總族別上**，這些是總數的身分分類，重加會重複計數。平地原住民與平埔原住民也是不同欄位。
6. 數值字串僅接受非負整數；空白、缺欄、`-`、非數字不可當 0。每列驗證男女、各族＋尚未申報、身分分類加總；若官方改定義，先產出異常報告，不能調整數字強求通過。
7. 同月人口分母由現有 `PopulationManifest` 所指的村里摘要取得，要求 `period/sourceMonth` 精確相等。按同一來源代碼集合加總，包含三和村；對照現有上層公開人口合計。若來源集合或分母年月不符，第一版建置失敗，不能拿最新人口或相近月份補。
8. 具名界線缺資料、資料對到未編定範圍、來源代碼找不到合法上層，均列異常並阻止發布。來源有統計但無圖形的已確認項目可保留在統計與例外報告。
9. 以村里加總產生 368 鄉鎮、22 縣市、全臺；保存原始整數，不儲存捨入百分比。每族 `0 ≤ 人數 ≤ 原住民總計 ≤ 總戶籍人口`。
10. 無紀錄＝`null`／無資料斜紋；官方明列 0＝0；分母為 0 時比例＝`null`、面板顯示「總戶籍人口為 0，比例無法計算」，人口數仍可為 0。比例顯示最多二位小數；正數若小於 0.01% 顯示 `<0.01%`，避免誤顯示 0%。

## 4. 靜態資料契約

新目錄採 `indigenous`，與既有人口 repository 分離。在建置時將同月總人口嵌入新摘要，前端只載入一套當期分片；這樣後續一般人口主題換月也不會悄悄改變本主題分母。保留分母來源版本、來源 SHA-256、所用公開分片的雜湊／清單供核對。

```text
data/indigenous/
  sources.json                 各月來源、頁 URL／SHA、合併 SHA、取得日、分母來源
  tribes.json                  明列族別欄位與中文標籤
  expected-exceptions.json      人工核對的來源無界線與名稱差異
data/raw/indigenous/11508/       忽略提交的原始四頁 JSON 與合併檔
scripts/indigenous/
  fetch.py                     固定月份、完整分頁、原子保存
  build.py                     嚴格正規化、代碼對照、同月分母、逐層彙總
  check.py                     僅使用公開輸出與登錄檔的發布檢查
public/data/indigenous/
  manifest.json                目前版本指標，最後才替換
  2026-08/manifest.json         固定月份版本、來源、族別、覆蓋與檔案模板
  2026-08/national.json
  2026-08/counties.json
  2026-08/towns/{countyCode}.json
  2026-08/villages/{townCode}.json
  2026-08/join-report.json
```

每個分片帶 `schemaVersion: 1`、`period`、`level`、`parentCode`（縣市集合／全臺不需要）及 `records`；全臺用 `record`。每筆建議型別：

```ts
interface IndigenousRecord {
  code: string; name: string;
  countyCode?: string; townCode?: string;
  totalPopulation: number; // 同月全體戶籍人口分母
  indigenous: number; male: number; female: number;
  undeclared: number;
  tribes: Record<string, number>; // 僅含 manifest 當期支援的族別
}
```

manifest 至少含：`schemaVersion`、`period`、`sourceMonth`、`label`、`populationType: 'registered'`、`supportedTribes`（id／label／sourceLabel）、`denominatorPeriod`、分子／分母來源、檔案模板、report 路徑與覆蓋數。採 staging 目錄，資料驗證全數成功後再替換該月目錄及根 manifest；失敗不得破壞現行資料，不覆寫其他主題。

## 5. 前端實作位置與行為

| 檔案 | 要做的事 |
| --- | --- |
| `src/data/indigenous.ts`（新） | `IndigenousRepository`：manifest、`loadRegions(level,parentCode)`、同步 `get(code)`、`getNational()`；20 秒逾時、成功快取、失敗移除快取、單片全驗證成功後才發布記錄 |
| `src/apps/indigenous/theme.ts`（新） | 指標／族別 query 解析、純計算、格式、固定級距／顏色／圖例、缺漏判斷；族別清單由 manifest 提供 |
| `src/apps/indigenous/panel.ts`（新） | 兩個選單、範圍摘要、分母說明、年月、族名原文註記、圖例、來源；DOM listener 用 AbortController 清理 |
| `src/apps/indigenous/main.ts`（新） | 組合 BoundaryRepository、IndigenousRepository、RegionNavigator、RegionLayer、shell；可參考 population 主題，但不複製年度／播放邏輯 |
| `src/apps/indigenous/style.css`（新） | 只放本主題樣式；760px 手機下沿用 shell，可捲動面板與圖例搬移 |
| `src/routing/hash-router.ts` | themes 加 `indigenous`；原本 transferTheme 已支援一般村里型主題，確認保留地理代碼與獨立 query |
| `src/main.ts` | loaders 加動態 import `startIndigenousApp`；不靜態匯入全部主題 |
| `src/ui/map-shell.html` | 加「原住民」主題連結；驗證第七項在手機不溢出，必要時小幅調整共用導航 CSS |
| `scripts/vite/initial-preload.mjs` | 主題來自 themes，理應自動收錄；確認實際 build chunk 與 CSS，不加另一份硬編碼清單 |
| `package.json`／發布 workflow | 加三個 npm 命令及 `indigenous:check`；既有資料檢查照常執行 |
| `README.md`、`docs/routing.md`、`docs/architecture.md`、`AGENTS.md` | 更新七主題、路由、模組與新資料更新方式；新增 `docs/indigenous.md` |

新主題只有 hash 入口，不需要 `indigenous.html` 或修改 Vite 多入口。基準專案 population 主題也沒有 `entry.ts`，直接由 `main.ts` 匯入，沿用實際程式結構。

### 5.1 路由與狀態

```text
#/indigenous?metric=population&tribe=all
#/indigenous/10015/10015010?metric=share&tribe=amis
#/indigenous/10015/10015010/10015010001?metric=population&tribe=siraya
```

範例示意 URL 結構；實測深層連結需先確認代碼存在。ID 保持 ASCII，達悟族使用 `tribe=yami`。無／非法 metric 預設 population；族別待 manifest 驗證後，非法或當期不支援值回 all，再經 routing.commit 正規化 URL。只保留本主題的 `metric`／`tribe`，不沿用人口的 `year`。

同主題返回父層保留目前指標與族群，與現有人口／政治主題一致；直接連結依 URL 還原。選單更新 replace 當層歷史，逐層導航 push，不能 panel 直接寫 history。跨主題保留村里（學區／房價仍止於鄉鎮），各主題 query 獨立記憶，相機由既有 history.state 管理。

載入幾何與當層摘要使用 Promise.all。資料成功後才提交 View／URL／選取；不要把主題資料寫回共用 GeoJSON。指標與族群切換只重算目前已載入分片，不下載每族獨立檔案；使用既有保留相機的 render 流程，維持搜尋、村里選取及手機收折。需要還原路徑時用 navigator 請求序號，快速切換、返回、home、destroy 均讓舊操作失效，舊回應不能取消新 loading。

資料或程式失敗可重試，分享在載入／錯誤期間停用。第一個 View 直接定位，後續導航用現有相機動畫；無需修改共用取景演算法。底圖採 `monoLight`、`zh-Hant`；沒有 key 的預覽仍可使用界線。

### 5.2 顏色、排序、零值

採單一連續色系（可沿用人口主題七色），所有族群與各單族共用同層級距，讓族群間可比較。0 用獨立淺色及「0 人／0%」圖例；正數採七色；缺漏斜紋；周邊可切換行政區灰色。不要把零與無資料共用樣式。

| 指標／層級 | 正值六個切點（七色） |
| --- | --- |
| 人數／縣市 | 100、1,000、5,000、10,000、30,000、100,000 人 |
| 人數／鄉鎮 | 10、100、500、1,000、5,000、10,000 人 |
| 人數／村里／detail | 5、20、50、100、300、1,000 人 |
| 比例／所有層 | 0.1、1、5、10、25、50% |

這是第一版指定級距；Luna 以真實分布和桌面／手機圖例驗證可讀性，如需調整可在完成報告說明，但不得依當前可見區或每族重新計算分位數。區間採下界含、上界不含，圖例顯示「大於 0、未滿 X」「X 至未滿 Y」「X 以上」。人數不要沿用一般人口大級距，否則小族幾乎看不出差異。

地圖、清單、tooltip、資訊卡與圖例共用 theme 的同一套 value／formatting。排序依目前指標由大到小、缺漏最後、同值以代碼排序。切換後清單搜尋結果仍在，ARIA label／live 摘要同步更新，不靠顏色單獨傳達資訊。

## 6. 可逐項執行的工作順序

| 項目 | 前置 | 具體交付與完成條件 |
| --- | --- | --- |
| A：來源與族別登錄 | 讀 AGENTS、git status | 寫 tribes／來源格式；取得完整四頁並記錄雜湊，確認 26 組族別與 7,781 列；新欄位有明確處理 |
| B：資料管線 | A | fetch／build／check；同月分母、各層分片、manifest、join report；初次輸出符合第 2.1 節，檢視 23 個名稱差異與三和村後建立例外 |
| C：repository 與純函式 | B | 寫 src/data/indigenous.ts、theme.ts、資料及指標測試；不完整／錯月分片拒絕入快取，可重試 |
| D：地圖與面板 | C | main／panel／CSS，兩選單、著色、列表、卡片、圖例、來源；手機與鍵盤可用，切換不重設視角 |
| E：路由與啟動 | D | 第七個主題連結、dynamic loader、query、跨主題／分享／歷史；preload 只載入本主題，其他主題冷開不下載新資料 |
| F：回歸與交付 | B–E | CI 加檢查、文件更新、全套檢查、桌面／手機瀏覽器驗證，記錄限制及未完成項 |

核取清單：

- [x] A：完成 ODRP018 分頁下載器及 26 族欄位登錄。
- [x] B：完成正規化、同月分母、村里／鄉鎮／縣市／全臺資料及逐層發布檢查。
- [x] C：完成 repository、指標／格式函式、快取／失敗重試測試。
- [x] D：完成兩選單、三層地圖、摘要、色階、來源與手機資訊面板。
- [x] E：完成深層分享、返回、跨主題位置、各主題 query 記憶與動態載入。
- [x] F：完成 CI、文件、全套檢查、正式 Pages base 建置及桌面瀏覽器回歸；窄版介面已觀察，未覆寫成精確 390×844 viewport。

建議提供的命令（需先在 package.json 實作）：

```sh
npm run indigenous:fetch -- 11508
npm run indigenous:build -- 11508
npm run indigenous:check
```

下載器固定月參數；如 API 失敗，只能從同官方目錄取得已核對的該月 CSV resource URL 作明列 fallback。驗證格式／年月／欄位／代碼與總數後保存來源，不猜 URL，不把部分月份或其他機關不同粒度資料混入。一般前端開發使用已提交的公開生成資料，CI 不重新下載官方 API。

## 7. 驗收與測試要求

新增測試的目的在保護資料與互動的實際風險，避免只檢查實作常數。

| 測試 | 至少涵蓋 |
| --- | --- |
| `tests/indigenous.test.mjs` | 人數與比例計算、零值／缺資料／零分母、格式、圖例、非法 query、並行分片快取、完整驗證後才發布、失敗重試 |
| 既有 routing／theme-app-host／initial-preload | 第七主題、深層連結父層、返回保留族群、跨主題 query／相機、晚到載入、當前主題 CSS 與 Pages base |
| `scripts/indigenous/check.py` | 僅讀公開檔；每族與男女加總、分母不小於分子、逐層一致、完整支援族別、覆蓋與已核對例外；初次快照與來源記錄一致 |

全套命令：

```sh
npm test
npm run data:check
npm run income:check
npm run school:check
npm run housing:check
npm run population:check
npm run politics:check
npm run indigenous:check
npm run build -- --base /TaiwanDistrictMap/
git diff --check
```

瀏覽器按 AGENTS 使用 CUA；先確認可用 server，不停止使用者 server。桌面與 **實際 390×844 viewport** 分別驗證：

- 全臺 → 花蓮／臺東／新北等不同分布縣市 → 鄉鎮 → 村里 → 返回／home；清單搜尋與灰色鄰區切換。
- 所有族群、阿美族、達悟族、卡那卡那富族、西拉雅族與當期總數為 0 的族別；人數／比例兩模式。
- 具名村里確實 0、未編定範圍無資料、不同級距邊界及極小比例文字。
- 指標／族群切換保留相機、選取、搜尋與面板收折；連續操作與延遲／503 後重試，舊回應不覆寫。
- 分享直開、refresh、網站返回、Back／Forward、跨 admin／population／school／housing／politics，再回本主題保留偏好。
- 手機第七個導航項目、選單長族名、圖例捲動、handle 拖曳／鍵盤、inert、reduced-motion、比例尺避讓。
- production Pages base 的資料與 chunk 正確，冷開其他主題未載入原住民分片；共用導航改動需回歸行政區／所得／學區三頁。

驗證完成後清除自建暫時分頁、viewport 覆寫與 server，保留使用者環境。記錄實際檢查結果，不以目前文檔裡的舊測試數量宣告成功。共享 bundle 超過 500kB 的已知提示不算失敗。

## 8. 交給 Luna 的執行提示

## 8. 執行結果

- 已新增 `#/indigenous`，以原生選單切換人口數／占總戶籍人口比例及所有族群／單一族群；指標和族群保存在 hash query。
- 資訊面板增設可收折「各民族人口數」，在每個目前顯示範圍列出全部 26 族、明確顯示零值，並將尚未申報人數分開標示；切換區域時保留收折狀態。
- 11508 ODRP018 四頁共 7,781 筆來源資料已保存、雜湊登錄並生成靜態分片；分母取同月 ODRP014。26 個族別欄位包含西拉雅族，尚未申報納入 all。
- 具名界線全部對應；三和村一筆保留在上層統計，23 筆名稱差異依代碼核對。公開檢查器逐欄驗證鄉鎮／縣市／全臺聚合。
- 全臺資料為原住民 639,340 人、同月總戶籍人口 23,224,721 人；測試為 141 個 Node、18 個 Python 測試通過，七類資料檢查與 `npm run build -- --base /TaiwanDistrictMap/` 通過。建置只有既有的大型共用 bundle 警告。
- CUA 桌面瀏覽器實測全臺 → 臺南市 → 玉井區 → 玉井里，切換西拉雅族比例、URL query、零值說明及返回階層均正常；未能覆寫精確 390×844 viewport，需在可設定手機尺寸的瀏覽器環境補驗。
- 實作後本機網址：`http://127.0.0.1:5173/#/indigenous`。目前只是工作目錄成果，未提交、未推送、未部署。
