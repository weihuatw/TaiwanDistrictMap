# 共用行政區地圖架構

行政區瀏覽頁由地圖核心與共用介面組合而成。底圖、圖資載入、導覽、圖層與頁面 DOM 各自維護自己的狀態，透過型別與回呼連接。

```text
index.html                       HTML 入口與 #app 掛載點
src/main.ts                      啟動行政區頁、共用 CSS、開發時清理
src/apps/admin/main.ts           行政區瀏覽的組合與設定

src/map-core/
  types.ts                       行政區、畫面、相機、來源等共用型別
  create-map.ts                  TomTom / 無 key 預覽、底圖狀態、worker
  boundaries.ts                  圖資及 manifest 載入、成功結果快取
  navigation.ts                  逐層導覽、同層切換、返回、請求競態
  camera.ts                      範圍放大、相機保存及恢復
  region-layer.ts                填色、灰色鄰區、點擊、滑過、標籤

src/ui/
  map-shell.html                 共用介面模板
  map-shell.ts                   清單、搜尋、導覽、來源視窗、提示
  style.css                      共用桌面及手機樣式

src/geometry.mjs                 前端與資料管線共用的幾何及代碼工具
scripts/                         官方資料下載、轉換與驗證
public/data/                     現有預先生成的界線與版本資訊
```

## 模組的責任與連接方式

- `createMap({ container, apiKey, onStatus })` 接收容器與 key，回傳地圖及清理方法。key 僅由應用入口讀取環境變數。底圖狀態是 `preview`、`unavailable` 或 `ready`，模組不寫入頁面文字。
- 有 key 時使用 TomTom SDK 的 `standardLight` vector 底圖（`include: []`、`zh-Hant`），無 key 時保持網格預覽。行政區填色與輪廓置於底圖 symbol 文字圖層下方。地圖容器的 `data-basemap-type` 與 `data-basemap-loaded` 記錄實際底圖來源類型及載入狀態，內容不含 key。
- `BoundaryRepository(dataUrl)` 接收圖資根路徑。`load(file)` 提供 GeoJSON，`manifest()` 提供來源與版本。失敗請求不進入快取，重試可以重新載入。
- `RegionNavigator` 接收資料載入函式與畫面、載入狀態、錯誤回呼。它不依賴 TomTom、MapLibre、fetch 或 DOM；原有逐層返回與灰色鄰區切換邏輯維持相同。
- `createRegionLayer(map, options)` 接收畫面資料與周邊區域，處理圖層和標籤。點擊及滑過透過回呼交給應用。標籤避讓區域與地圖邊距由介面提供，圖層不查詢頁面的元素 ID。
  學區頁啟用 `deferUntilMoveEnd`，下載仍與相機動畫並行，最新已提交畫面在 `moveend` 後的 animation frame 才更新 GeoJSON、標籤與學校 marker。更新前後分別保留欲呈現與實際呈現狀態，避免舊 polygon 被當成新資料點擊。行政區來源載入完成後，以 MapLibre 圖層透明度做 180ms 淡入，不等待底圖的全域 idle；減少動態效果時取消淡入。所有頁面的標籤避讓在相機停止後計算，先集中量測再寫入樣式，避免動畫期間每幀強制排版。待執行更新採最新畫面優先，destroy 時取消 frame 並解除事件。
- `createMapShell(root, options)` 掛載共用 HTML，處理頁面 DOM。它不下載資料、不建立底圖、不持有導覽歷史。
- `startAdminApp(root)` 將上述回呼接在一起，是目前行政區瀏覽的應用層。

地圖與清單的 `getColor(region)` 接受同一個配色函式。目前行政區頁仍採圖資中的固定配色；未來可改由主題資料決定顏色。圖層使用呈現用的 `displayColor`，不把主題資料寫回官方界線或共用快取。

## 之後加入主題頁

新增主題時，建立自己的 HTML 入口與 `src/apps/<主題>/`，在應用層組合共用模組；由 Vite 配置新增 HTML 建置入口。現有 `income.html` 與 `src/apps/income/` 已示範主題資料、色階與面板如何組合；行政區頁仍以原本的入口提供。

所得頁透過共用介面的標題、清單文字、排序與提示回呼接入主題內容；共用圖層可設定透明度、輪廓與資料缺漏斜紋。這些選項皆有原本的預設值，行政區瀏覽不需讀取所得資料。主題資料放在 `public/data/income/`，界線重建只替換其自身管理的檔案，保留主題資料。

主題資料以行政區代碼與界線連接，保持字串及前導零。票數計算、學區關係、年份篩選與主題面板放在該主題的目錄內。界線根路徑可注入 `BoundaryRepository`，未來切換歷年界線時不必修改導覽或圖層。

如需不同的提示或詳細資料，應用可以提供自己的滑過回呼與面板，或擴充共用介面。`region-layer.ts` 不需要知道選舉或學校的資料格式。

## 清理與驗證

應用的 `destroy()` 取消尚未完成的導覽、移除地圖事件與標籤、釋放地圖並移除介面。資料來源請求在頁面移除後不再更新 DOM；共用介面的 Escape 事件亦會解除。

`npm test` 直接測試共用 TypeScript 的導覽與圖資模組，涵蓋請求競態、同層切換、返回、頁面清理、快取及失敗重試。`npm run build` 執行 TypeScript 檢查並生成純靜態成果。瀏覽器驗證與畫面保存在 [verification.md](verification.md)。

學區頁 `school.html` 與 `src/apps/school/` 使用獨立的學校導覽狀態，第三層以學校點位與選校後的學區里界替代全區村里。資料及互動方式見 [學區地圖說明](school.md)。
