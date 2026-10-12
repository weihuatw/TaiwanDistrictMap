# 全臺村里戶籍人口

行政區入口：[index.html](../index.html)，人口主題入口：`#/population`。資料採內政部戶政司[村里戶數、單一年齡人口（新增區域代碼）](https://data.gov.tw/dataset/77132)，按統計年月製作靜態快照，前端不即時連線到戶政司。

人口表示戶籍登記人口，不代表常住或實際居住人口。桌面與手機都在原本資訊面板下方顯示目前全臺、縣市、鄉鎮市區或所選村里的資料。人口區可收折，收折時保留人口總數；展開狀態在同一頁的區域切換間保留。未編定範圍顯示無村里統計，不當作人口為零。

## 資料設計

- 以 11 碼字串區域代碼連接村里；前導零不可轉成數字，村里名稱只供顯示與差異報告，不作模糊配對。
- 共用型別及 `PopulationRepository` 位於 `src/data/population.ts`。可讀取村里、鄉鎮、縣市、全臺彙總及單一年齡性別分布，與 map theme、GeoJSON cache 分開。
- `public/data/population/manifest.json` 指向目前月份；資料按年月存放，村里與年齡資料按鄉鎮分片，縣市／鄉鎮及全臺彙總分層提供。
- 年齡資料與人口摘要分檔；只顯示總人口的頁面不會載入 0–100+ 歲資料。
- 11508 基準快照有 7,781 筆官方村里資料。7,780 個具名圖形都按代碼匹配；瑪家鄉三和村 `10013280006` 有戶籍統計但沒有全國主圖層圖形，保留統計並記錄例外。206 個未編定範圍沒有村里戶籍資料。
- 對照報告記錄代碼相符但來源名稱與界線名稱不同的情形。目前 23 筆差異以官方造字或字形標記為主，保留兩邊名稱及代碼。

## 更新與建置

```sh
npm run population:fetch -- 11508
npm run population:build -- 11508
npm run population:check
```

`population:fetch` 的年月參數是民國五碼年月，例如 `11508`。下載前先在戶政司 API 確認月份已發布且完整。不要只按「最新」自動更新，避免不完整或尚未核對的統計年月覆蓋目前快照。

- 忽略提交的原始 CSV：`data/raw/population/{年月}.csv`。
- 來源網址、年月、取得時間與 SHA-256：`data/population/sources.json`。
- 已審核的來源／圖形例外清單：`data/population/expected-exceptions.json`。新增或消失的差異需先檢視 `join-report.json`，確認後才更新清單。
- 公開快照、年齡分片及對照報告：`public/data/population/{西元年月}/`；根目錄 `manifest.json` 指向目前版本。

建置檢查每筆人口男女加總、單一年齡與三組年齡摘要加總、重複代碼、所有具名圖形覆蓋及縣市／鄉鎮／全臺加總。CI 的 `population:check` 僅讀取已提交輸出，不依賴被忽略的原始 CSV。

## 共用前端讀取

行政區頁透過共用 shell 的 `infoExtra` 插槽及 `src/apps/admin/population-panel.ts` 顯示目前層級的摘要；其他地圖可直接使用 `PopulationRepository`，依代碼呼叫 `getVillage`、`getTown`、`getCounty`、`getNational` 或 `getVillageAges`。方法回傳資料年月及來源標籤；成功結果快取，失敗不快取。請使用 `import.meta.env.BASE_URL` 組合資料目錄，並在呼叫端忽略過期選取的非同步結果。

## 人口主題與指標

`src/apps/population/` 組合共用行政區導覽、人口 repository、主題面板及圖例。`PopulationRepository.loadRegions(level, parentCode)` 只下載目前層級摘要，驗證年月、層級、父層及年齡／男女加總後提供同步 `get(code)`；失敗不發布至記錄快取，可重試。

- 指標：人口數（`population`）、戶數（`households`）、65 歲以上比例（`elderly`）、0–14 歲比例（`young`）、女性比例（`female`）。預設人口數。
- 摘要另含 `age0to14`、`age15to64`、`age65plus`，由官方單一年齡男女數在建置時彙整。各層以人數加總後計算比例，不平均下層百分比；前端不需下載年齡明細。
- 人口數及戶數使用同層固定總量級距，明確標示非人口密度；比例使用全國各層相同級距，零人口的比例視為無法計算。
- 切換指標更新填色、圖例、清單排序及數值，保留目前相機、選取、搜尋與手機面板收折狀態。周邊行政區保留灰色並可切換，未編定範圍顯示無資料斜紋。
- 指標寫入 hash query，例如 `#/population/63000/63000020/63000020001?metric=elderly`。直接連結依 URL 還原；同主題返回父層保留目前指標。
- 主題程式與 CSS 動態載入，圖例在手機移入可捲動面板。年月、單位及戶籍人口定義在面板顯示。
- 遷入／遷出尚未提供；自然增減直接使用出生、死亡登記，不以總人口差推測遷徙。

## 年度出生、死亡、自然增減與密度

年度資料提供 2020–2025。選擇「年度統計」下的任一指標後，指標選單下方會顯示年份滑桿，年份由舊至新排列。播放會從目前年份逐年前進；若目前已是最新年，則先回到最早年。每年停留 2 秒、年度間以 400 毫秒漸層轉色，預載目前地圖層級的年度資料以降低等待。年份會保留在 `year` query，可分享年度與地區；月度人口、年齡與性別指標不載入年度分片。月度人口快照與年度出生／死亡、人口密度分開顯示，不混用年月。

| 指標 query | 定義 | 可用層級 |
| --- | --- | --- |
| `density` | 選取年度年底戶籍人口 ÷ 官方土地面積，單位人／km² | 全臺、縣市、鄉鎮 |
| `births` / `deaths` | 選取年度十二個月出生／死亡登記人數合計 | 全臺至資料完整的村里 |
| `birthRate` / `deathRate` | 全年出生／死亡登記 ÷ 年中人口 × 1,000，單位 ‰ | 同上 |
| `naturalIncrease` / `naturalRate` | 出生登記 − 死亡登記；比率再除年中人口 × 1,000 | 同上 |

年中人口採前一年及當年年底人口的平均。粗出生率不是總生育率；登記數依登記月份統計，可能包含前期事件。各層先加總人數、面積或分母再相除，不平均各村里比率。自然增減不含遷入遷出。密度取自[內政部官方鄉鎮資料](https://data.gov.tw/dataset/8410)的人口及土地面積，依官方人口除面積計算；縣市與全臺先加總所屬鄉鎮人口及面積再相除，不估算村里面積。較早年度官方表只公布整數密度，地圖使用該表的人口與面積計算較精細數值。原表東沙、南沙沒有戶籍人口數，不混入 368 鄉鎮彙總面積。

出生及死亡採戶政司 [ODRP010 舊版月報（107 年至 109 年 8 月）](https://data.gov.tw/dataset/77140)及 [ODRP060 月報（109 年 9 月起）](https://data.gov.tw/dataset/131138)，年底人口採 [ODRP013 API](https://www.ris.gov.tw/rs-opendata/api/Main/docs/v1)。2020 年 1–8 月使用 ODRP010、9–12 月使用 ODRP060；2022 年 3 月的 API 回覆查無資料，改用同一官方資料集發布的 [11103 CSV](https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/F6CC65BA-B0EF-4C36-843A-27128DDBC824/resource/389A8440-FF51-497F-9AD8-5C201812A10C/download)。下載器驗證所有分頁、紀錄數、重複代碼與統計月份，建置驗證出生／死亡及年底人口男女加總。2025 全臺出生 107,812 人、死亡 200,268 人，自然減少 92,456 人，年底人口 23,299,132 人。

22 縣市、368 鄉鎮在六年皆完整。現行 7,780 個具名村里可呈現完整事件的人數依序為：2020 年 7,701、2021 年 7,701、2022 年 7,719、2023 年 7,734、2024 年 7,733、2025 年 7,734。缺完整十二個月或兩年底人口的村里保留 `null`，不補零，也不把舊村里任意分攤到新村里。2020 年四個高雄舊鄉鎮代碼依村里代碼合併到目前三民、鳳山行政區；其他歷史來源代碼與三和村仍保留在上層統計。`observedBirths/observedDeaths` 只供檢查部分月份與上層加總，不冒充全年數字。

`AnnualPopulationRepository` 位於 `src/data/population-annual.ts`，只在切換年度指標時載入年度索引、選取年度 manifest、全臺及當前導覽層級分片；人口概況不下載年度分片。每片驗證年度、父層、事件完整性、分母及面積；失敗不發布記錄且可重試。切換指標或年份待資料成功才提交，沿用導覽請求序號，取消／清理後不得更新畫面。

密度模式以 `restorePath(ids, true)` 選取鄉鎮，保留鄉鎮圖形而不下鑽村里；村里畫面切密度時回到所屬鄉鎮，URL 同步縮短。切回其他指標才載入村里圖形。切換保留相機與手機面板狀態，歷史返回沿用目前指標。年度切換只更新主題資料並保留現有相機；`region-layer.ts` 將前後年度的區域色彩存於呈現用 GeoJSON，再以 MapLibre global state 在 400 毫秒內插值，不逐幀重送幾何資料。使用者啟用減少動態效果時，色彩轉場立即完成。

```sh
npm run population:annual:fetch -- 2020 2021 2022 2023 2024 2025
npm run population:annual:build
npm run population:check
```

- 原始年度 API 資料表及密度 CSV：忽略提交的 `data/raw/population/annual/{year}/`。
- 來源、取得日、逐頁與合併檔 SHA-256：`data/population/annual-sources.json`。
- 每年公開分層摘要、manifest 與對照報告：`public/data/population/annual/{year}/`；`annual/manifest.json` 列出可用年份，按新到舊排序。
- 已核對的缺漏、歷史代碼及字形差異：`data/population/annual-expected-exceptions.json`，建置不自動更新。
- `population:check` 同時驗證月度、年度輸出；年度檢查不需要原始檔，核對逐層登記數、兩年底人口、面積加總、十二個月與已審核例外。

下載器目前固定登錄 2020–2025 官方密度 CSV resource URL。補新年度時需先核對官方資源及月份 API，不能猜 URL；檢視新的對照報告後才更新例外清單。
