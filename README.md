# 臺灣行政區地圖

全螢幕 TomTom 地圖，以國土測繪中心官方行政區界顯示縣市、鄉鎮市區與村里。點選色塊逐層放大，左上角返回上一層並恢復先前視角；區域清單可搜尋名稱或行政區代碼。

另有 [2024所得地圖](income.html)，用財政部初步核定資料顯示各層平均年綜合所得，沿用相同導覽。詳細指標、對照限制與資料流程見 [所得地圖說明](docs/income.md)。

GitHub repo：[weihuatw/TaiwanDistrictMap](https://github.com/weihuatw/TaiwanDistrictMap)。網站透過 GitHub Actions 發布至 GitHub Pages：

- [行政區地圖](https://weihuatw.github.io/TaiwanDistrictMap/)
- [2024所得地圖](https://weihuatw.github.io/TaiwanDistrictMap/income.html)

## 本機啟動

需求：Node.js 24 以上與 npm。資料轉換另需 Python 3 與 curl。

```sh
npm install
```

在專案根目錄建立 `.env.local`，自行填入：

```dotenv
VITE_TOMTOM_API_KEY=你的TomTomKey
```

`.env.local` 已被 Git 忽略；`.env.example` 僅提供設定欄位。修改環境檔後 Vite 會重新啟動，瀏覽器若沒有更新，重新整理即可。

```sh
npm run dev -- --port 5173 --strictPort
```

開啟 <http://127.0.0.1:5173/>。沒有 key 時仍可操作官方行政區圖形，底圖顯示為資料預覽背景。

所得頁開啟 <http://127.0.0.1:5173/income.html>。

TomTom key 支援網域白名單。使用此專案專用的 key，設定開發及發布網站的允許網域與所需地圖產品。前端變數會進入瀏覽器程式和地圖請求；環境檔的作用是避免將 key 提交到原始碼，並非對訪客隱藏 key。

## 功能

- 全臺 22 縣市，以固定配色、半透明填色和輪廓顯示。
- 點選縣市載入其鄉鎮市區，再點選鄉鎮市區載入村里。
- 選取縣市或行政區後，其他同層區域保留為淺灰色，可直接點擊切換。查看村里時也保留周邊縣市；切換後僅顯示新選取範圍的下一層界線。
- 點選村里放大及高亮，顯示名稱與官方代碼；返回時恢復區域概覽。
- 返回按鈕、麵包屑和全臺快捷鍵。
- 目前層級的區域清單，可搜尋名稱與代碼，支援「台／臺」輸入。
- 村里資料按鄉鎮市區分檔，依需要載入並快取；處理快速點選與載入失敗重試。
- 桌面與手機版面、滑過提示、避讓標籤、鍵盤操作及減少動態效果偏好。
- 資料來源與實際發布檔案版本可在右上角資訊按鈕查看。

## 官方資料與版本

提供機關：內政部國土測繪中心。授權：[政府資料開放授權條款－第1版](https://data.gov.tw/license)。

2026-10-07 已核對[國土測繪圖資 e 商城開放資料清單](https://whgis-nlsc.moi.gov.tw/Opendata/Files.aspx)，三層版本與政府資料開放平台提供的檔案一致。

| 層級 | 官方入口 | 主檔版本 | 展示圖形數 |
| --- | --- | --- | ---: |
| 縣市 | [7442](https://data.gov.tw/dataset/7442) | COUNTY_MOI_1140318（2025-03-18） | 22 |
| 鄉鎮市區 | [7441](https://data.gov.tw/dataset/7441) | TOWN_MOI_1140318（2025-03-18） | 368 |
| 村里 | [7438](https://data.gov.tw/dataset/7438) | VILLAGE_NLSC_1150817（2026-08-17） | 7,986 |

村里圖形包含 206 個「未編定村里」範圍，所以圖形數不是正式村里的統計數。所有識別碼保留字串，包括前導零及未編定範圍的英文字母。

官方下載另外附有 `Town_Majia_Sanhe` 與 `Village_Sanhe`。補充範圍與全國主圖層有重疊；第一版依全國主圖層展示，另附圖層保留在原始下載中，沒有自行裁切或混用不同版本。這項選擇記錄於頁面資料來源及 `public/data/manifest.json`。

全臺初始視野涵蓋本島、澎湖、金門與馬祖。縣市概覽聚焦臺灣周邊，避免南海等遠方圖形將視野拉得過大；所有來源幾何仍保留，個別村里選取使用其完整範圍。

資料經 WGS84 轉換與共邊拓樸簡化，縣市／鄉鎮市區／村里簡化距離分別為 90／35／10 公尺。座標精度保留到小數點後六位，不能將展示用圖形視為測量成果。資料版本、來源、下載時間、雜湊及處理參數均有保存。

## 資料重建

預先生成的 `public/data/` 可直接用於開發及靜態部署，不必在每次建置時下載圖資。

```sh
npm run data:fetch
npm run data:build
npm run data:check
```

下載腳本目前使用官方入口在 2026-10-07 所列的網址。更新資料時，先核對官方入口及 e 商城、更新 `scripts/fetch-data.py` 的來源與日期，再執行流程。詮釋資料更新日、檔案版本日、上架日與行政區異動生效日可能不同。

- `data/raw/`：官方 ZIP、SHP 及補充檔；不提交 Git。
- `data/sources.json`：下載來源、版本、雜湊與原始檔識別。
- `public/data/counties.geojson`：全臺縣市，約 239 KiB。
- `public/data/towns/{COUNTYCODE}.geojson`：各縣市的鄉鎮市區。
- `public/data/villages/{TOWNCODE}.geojson`：各鄉鎮市區的村里；最大單檔約 125 KiB。
- `public/data/manifest.json`：公開版本與處理說明。

## 驗證與建置

```sh
npm test
npm run data:check
npm run build
npm run preview -- --port 4173 --strictPort
```

測試涵蓋逐層返回與視角保存、灰色同層區域切換、切換後的圖層及導覽路徑、請求競態、取消載入、失敗重試、村里切換、離島範圍及共邊配色。資料檢查涵蓋全部輸出圖形、代碼唯一性、父子關係、座標、環閉合、標籤點位於圖形內及輸出數量。

`dist/` 為純靜態成果，本機建置預設使用相對 base 路徑。MapLibre worker 由 Vite 一併打包。

## GitHub Pages 部署

`.github/workflows/deploy-pages.yml` 在每次推送至 `main` 或手動執行時，使用 Node.js 24 安裝鎖定的相依套件、執行測試及兩種資料檢查，再以 `/TaiwanDistrictMap/` 為 base 建置並發布 `dist/`。預先生成的 `public/data/` 隨原始碼提交，不必在 Actions 下載或重建官方資料。

Repository 的 Settings → Pages → Source 設為 **GitHub Actions**。在 Settings → Secrets and variables → Actions 設定 `VITE_TOMTOM_API_KEY`；工作流程缺少 key 時會停止，避免意外發布沒有底圖的版本。`.env.local`、原始下載檔、`node_modules/` 與 `dist/` 不提交。

TomTom key 的允許網域需包含 `weihuatw.github.io`。Secret 會在建置時注入前端，訪客仍可從網頁程式或地圖請求看到 key，應使用限縮地圖產品與網域的專用 key。

本機可用相同子路徑驗證：

```sh
npm run build -- --base /TaiwanDistrictMap/
npm run preview -- --base /TaiwanDistrictMap/ --port 4173 --strictPort
```

開啟 `http://127.0.0.1:4173/TaiwanDistrictMap/` 或 `http://127.0.0.1:4173/TaiwanDistrictMap/income.html`。

## 地圖整合

程式已拆分為 `src/map-core/` 共用核心、`src/ui/` 共用介面及 `src/apps/admin/` 行政區應用。根目錄 `src/main.ts` 只負責啟動，HTML 入口只有掛載點；底圖、圖資與圖層不依賴頁面的元素 ID。模組責任、回呼及新增主題方式見 [架構說明](docs/architecture.md)。

TomTom 底圖使用 SDK 的 `standardLight` vector style，語言設為 `zh-Hant`，不載入交通與地形等選用模組。行政區使用 MapLibre GeoJSON 填色／線段圖層，位於底圖文字圖層下方，保持道路及地名文字清晰。底圖、行政區資料和導覽各自獨立。官方文件：[SDK 樣式設定](https://docs.tomtom.com/maps-sdk-js/api-reference/types/map.StyleInput.html)、[Orbis 向量地圖](https://developer.tomtom.com/map-display-api/documentation/tomtom-orbis-maps/v1/product-information/introduction)。

SDK 版本沿用 ParkingMap 的 `0.51.3`；MapLibre 使用相容的 `6.13.0`。圖資處理工具只在建置資料時使用，不包含於前端網頁。
