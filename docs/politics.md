# 政治地圖

`politics.html` 已發布。全臺下拉選單提供「各縣市首長黨籍」、「2022 縣市長得票」與「2024 總統得票」；選取的模式跨縣市、行政區、村里及返回全臺時維持。全臺選舉模式按各縣市分別著色並列出領先政黨分布，不彙成全臺單一勝選黨。

## 顯示與語意

| 檢視 | 預設 | 可切換 |
| --- | --- | --- |
| 全臺、縣市圖形 | 縣市首長黨籍；可切換各縣市的縣市長／總統最高票政黨 | 依各縣市選舉結果上色，不彙成全臺單一總票數 |
| 一個縣市、鄉鎮市區圖形 | 2022 縣市長得票 | 2024 總統得票 |
| 一個行政區、村里圖形 | 本屆村里長名錄黨籍 | 2022 縣市長／2024 總統得票 |
| 選取村里 | 保留村里概覽模式 | 同上，展開人員或全部候選人明細 |

明確選取的模式會在所有支援它的層級沿用；若該層沒有此模式，使用該層已記錄模式或預設值。返回會恢復先前視角；切換模式保留相機。政治資料與人口接在同一資訊面板，均可收折。人口使用共用 `PopulationRepository`，不下載單一年齡分片。

行政區沒有同類區長選舉時，使用縣市長／總統票數在該行政區內的合計。鄉鎮市長及原住民區長選舉確實存在，但這一頁採統一縣市長／總統比較，不混入不同職務的結果。

「較高得票政黨」定義為此範圍**原始票數最多的候選人之參選推薦政黨**。無黨籍候選人逐人比較，不能把多位無黨籍者相加為一個政黨；行政區採官方原始票數合計，不以各里勝出數決定。最高票並列顯示獨立圖例及全部並列候選人；無有效票或無法對應顯示斜紋，均不當成零票或無黨籍。

## 官方來源

- [中選會選舉資料庫](https://db.cec.gov.tw/ElecTable)、[開放資料入口 13119](https://data.gov.tw/dataset/13119)：使用正式靜態 `tickets`／`profiles` JSON，包含縣市、鄉鎮市區、村里層的候選人、政黨及票數。參選政黨保留來源原文，不從政治支持或現任黨籍推測。
- 2024 總統副總統：`P0`、theme `4d83db17c1707e3defae5dc4d4e9c800`，投票日 2024-01-13。總統及副總統在官方 JSON 各有一列，但共用同張選票；只計一次，保存搭檔姓名。
- 2022 直轄市長：`C1`、theme `05cc7b904c7a30cc7c88d5b10898c98e`，2022-11-26。
- 2022 縣市長：`C2`、theme `63615098f5afa8ec53159c4a86fc01d3`，2022-11-26，15 縣市。
- 嘉義市長重行選舉：`C2`、theme `1275d73551f2c0caf202e803b1766057`，2022-12-18。覆蓋嘉義市，不用 11 月的延期紀錄。
- 內政部[直轄市長 7057](https://data.gov.tw/dataset/7057)、[縣市長 7058](https://data.gov.tw/dataset/7058)、[村里長 7061](https://data.gov.tw/dataset/7061)。開放 CSV 只是網站索引；實際名錄由[地方公職人員專區](https://www.moi.gov.tw/LocalOfficial.aspx?n=577&TYP=KND0007) POST `JLocalOfficial_ExportOds=轉出Ods` 取得。

內政部雖把匯出命名為 ODS，實際是 BIFF XLS。`xlrd` 依檔案實際格式解析；匯出包含歷屆，只保留 111 年度本屆資料，並排除被誤列在村里匯出中的其他職務。公開輸出只含人員姓名、職務、黨籍、來源及狀態，不保存住址、電話、信箱、照片或學經歷。

名錄「取得日」不是每筆現職／黨籍的更新日。村里人員預設狀態為 `registry`，不把中選會歷史 `is_current` 或當選人當作即時現任名錄。官方本屆同里多位人員時，保留衝突報告、黨籍留白；缺漏不以歷屆名錄補成現任。

## 逐筆補充

`data/politics/official-overrides.json` 記錄來源與 2026-10-08 查核日。

- 宜蘭縣：依[縣府代理縣長名錄](https://www.e-land.gov.tw/cp.aspx?n=2700)改為林茂盛、代理縣長。該來源沒有黨籍，保持未知；不沿用林姿妙的黨籍。
- 新竹市：依[2026 市府公告](https://www.hccg.gov.tw/hccg/app/data/view?id=30210&module=isfocusnews&serno=95445fe6-70be-4090-9e13-df8fdb639404)確認高虹安市長職務，依[中央社報導本人退黨聲明](https://www.cna.com.tw/news/aipl/202407260148.aspx)更新為無黨籍。
- 金門縣：依[縣長名錄](https://www.kinmen.gov.tw/cp.aspx?n=ADFC186F490AC26E)及[中央社引述民眾黨與幕僚的入黨確認](https://www.cna.com.tw/news/aipl/202304190402.aspx)更新陳福海為民眾黨；2022 參選推薦仍為中選會的無黨籍及未經政黨推薦。
- 苗栗縣：依[縣長名錄](https://www.miaoli.gov.tw/cp.aspx?n=265)及[中央社回復黨籍報導](https://www.cna.com.tw/news/aipl/202512080125.aspx)更新鍾東錦為國民黨；不回寫 2022 參選政黨。
- 斗南鎮：內政部本屆匯出 24 人漏列里名。以[鎮公所各里辦公室](https://dounan.yunlin.gov.tw/cp.aspx?n=5647)逐筆確認里名與姓名，再沿用相同人員的本屆名錄黨籍。逐筆來源及查核日均保留。

## 對照、缺漏與查核

2026-10-08 快照：

| 資料 | 可對照具名村里／現行具名村里 | 其他限制 |
| --- | ---: | --- |
| 本屆村里長名錄 | 7,649／7,780 | 131 里缺漏或衝突；18 里本屆名錄同列多位人員 |
| 2022 縣市長 | 7,713／7,780 | 67 里無單獨可對照結果 |
| 2024 總統 | 7,713／7,780 | 67 里無單獨對照；已對照中另 86 里只有部分分列票數 |

22 縣市首長與兩種選舉的 368 鄉鎮市區皆有記錄；宜蘭代理首長黨籍未知。206 個未編定範圍沒有政治資料。

對照使用完整縣市＋行政區＋村里名稱，NFKC、移除空白與台／臺正規化，再套 `data/politics/aliases.json` 逐筆字形別名。中選會代碼只用於辨識原始統計層級及加總，不直接假定等於 NLSC 代碼。字形別名與既有戶政代碼／NLSC 名稱交叉檢視；更名、拆分、合併不做相似比對或分攤。

人名保留官方「台／臺」字形，地名的正規化規則不套用於人名。
中選會以 `@HEX@` 表示的罕用字還原 Unicode（相容漢字用 NFKC），例如 `江@2F97F@淵` 顯示為江聰淵，原值保留於候選人的 `sourceName`。

連江縣多村合併票數、南投魚池鄉新城村／共和村的部分選民、嘉義市各里原住民票數由中選會另列。合併紀錄完整保存於公開報告，納入鄉鎮／縣市原始合計；不拆給任何單一村里。魚池 2 村與嘉義市 84 里因此標示 `partialReason`，保留分列票數供檢視，但不判定完整村里的最高票政黨。投票率只描述來源分列選民，不以戶籍人口當分母。

瑪家鄉三和村原始選舉資料保留在未對照報告及上層合計；遵守主圖層既有政策，不混入重疊補充幾何。

`join-report.json` 包含逐縣覆蓋率、未對照完整原始票數、名錄缺漏及衝突、名稱差異。候選人、有效票、無效票、選舉人數在歷史村里→行政區→縣市逐項完全相符；包含全部未對照原始紀錄。2024 全國候選人票數核對為 3,690,466／5,586,019／4,671,021，未重複計副總統票。

政黨配色集中 `data/politics/colors.json`，以網站辨識色搭配中選會色彩設定，不宣稱官方標準 HEX。未知／待查採斜紋、無黨籍採中灰、可切換鄰區採淡灰、最高票並列採獨立色。

## 資料管線與共用讀取

```sh
python3 -m venv .venv-politics
.venv-politics/bin/pip install -r scripts/politics/requirements.txt
export POLITICS_PYTHON="$PWD/.venv-politics/bin/python"
npm run politics:fetch
npm run politics:build
npm run politics:check
```

- `fetch.py` 以 curl 下載固定 election theme，維持 TLS 憑證驗證、逾時、重試；並行最多 4 請求。`data/politics/sources.json` 保存 URL、下載時間、方法／表單、SHA-256、大小及授權入口。
- 原始下載 `data/raw/politics/` 忽略提交。`.venv-politics/` 同樣忽略；前端開發直接用已生成資料，不必重新抓取。
- 更新快照先重新核對代理、補選、退黨／入黨與每筆人工補充，再更新查核日。建置會阻止把舊查核補充無聲套到新快照。
- `expected-exceptions.json` 固定已審核的缺漏及部分統計代碼；更新資料／界線後人工檢視差異，不能為通過檢查自動接受新的缺漏。
- `politics:check` 只用公開分片與報告，不需要 xlrd 或原始檔，已加入未來發布 CI。

公開分片：

```text
public/data/politics/manifest.json
public/data/politics/join-report.json
public/data/politics/officials/2026-10-08/{counties.json,towns/{county}.json,villages/{town}.json}
public/data/politics/mayor/2022/{counties.json,towns/{county}.json,villages/{town}.json}
public/data/politics/president/2024/{counties.json,towns/{county}.json,villages/{town}.json}
```

`PoliticsRepository` 的 `manifest()`、`load(mode, boundaryFile)`、`get(mode, code)` 主題資料與幾何獨立；各模式成功請求快取，失敗與格式錯誤移出快取，20 秒逾時。同一層載入三種行政區分片，模式切換立即生效，避免舊請求改寫模式。每個分片完整驗證後才提交 records。共用 RegionNavigator 控制更新序號、相機預覽、取消、重試與歷史；清理後晚到請求不得更新畫面。

## 本機驗證

```sh
npm test
npm run data:check
npm run income:check
npm run school:check
npm run housing:check
npm run population:check
npm run politics:check
npm run build -- --base /TaiwanDistrictMap/
git diff --check
npm run preview -- --base /TaiwanDistrictMap/ --port 4173 --strictPort
```

開啟 `http://127.0.0.1:4173/TaiwanDistrictMap/politics.html`。驗證桌面與 390×844 手機、逐層／返回、政治模式、人口與政治區收折、搜尋、來源、灰色鄰區、缺漏、合併票數、快速選取及失敗重試；其他四頁保留既有導覽並有政治連結。

### 2026-10-09 驗證紀錄

- 80 個 Node、12 個 Python 測試通過；行政區、所得、學區、房價、人口及政治六種公開資料檢查通過。全臺各縣市兩種選舉模式測試確認 22 縣市皆有可判定的領先候選人。
- TypeScript 與 `/TaiwanDistrictMap/` base 建置通過；保留既有共享 bundle 大於 500 kB 的提示。`git diff --check` 通過。
- 桌面 1280×800、手機 390×844：全臺→臺北市→文山區→木柵里、返回、三種模式切換、里長來源、人口與政治區收折、手機面板 Enter 展開及 inert、表格捲動、搜尋、來源視窗通過，手機無水平溢出。新增驗證全臺三個模式的顯示名稱及選取總統得票後進入縣市、返回全臺仍保持選取。
- 嘉義市長重行選舉日期為 2022-12-18；東區荖藤里總統票數顯示部分合併說明與斜紋；基隆暖暖八南里縣市長 277／277 票並列使用並列色；點擊灰色八堵里可直接切換。
- 宜蘭顯示代理縣長林茂盛及黨籍未載說明，並與 2022 參選人林姿妙分開；候選人江聰淵的罕用字編碼已正確還原。
- 使用本機可控延遲（4 秒）與首次 503：失敗保留臺北市，可重試進入文山區；快速由文山區改選大安區及載入中回首頁，晚到請求不改寫最新畫面。
- 原有行政區、所得、學區與房價四頁的桌面／手機入口、五頁導覽連結均正常；手機各頁寬度為 390px，無水平溢出。
- 學區圖層的周邊行政區遮罩透明度提高，renderer 支援各主題自行設定；回歸測試確認 transparency 為 0.32、hover 為 0.42。

預覽截圖：[桌面](politics-desktop.png)、[手機](politics-mobile.png)。
