# 全臺村里戶籍人口

行政區入口：[index.html](../index.html)。資料採內政部戶政司[村里戶數、單一年齡人口（新增區域代碼）](https://data.gov.tw/dataset/77132)，按統計年月製作靜態快照，前端不即時連線到戶政司。

人口表示戶籍登記人口，不代表常住或實際居住人口。詳細資訊卡標示資料月底及來源。未編定範圍顯示無村里統計，不當作人口為零。

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

建置檢查每筆人口男女加總、單一年齡加總、重複代碼、所有具名圖形覆蓋及縣市／鄉鎮／全臺加總。CI 的 `population:check` 僅讀取已提交輸出，不依賴被忽略的原始 CSV。

## 共用前端讀取

行政區資訊卡透過 `renderSelectionDetails` 插槽載入村里摘要；其他地圖可直接使用 `PopulationRepository`，依代碼呼叫 `getVillage`、`getTown`、`getCounty`、`getNational` 或 `getVillageAges`。方法回傳資料年月及來源標籤；成功結果快取，失敗不快取。請使用 `import.meta.env.BASE_URL` 組合資料目錄，並在呼叫端忽略過期選取的非同步結果。
