# 網址、分享與瀏覽器導覽

網站由根目錄 `index.html` 啟動，使用 hash 路由。GitHub Pages 只需要提供一個地圖入口；不生成各行政區 HTML。

## 網址格式

```text
/TaiwanDistrictMap/#/admin
/TaiwanDistrictMap/#/income/63000/63000020
/TaiwanDistrictMap/#/school/63000/63000020/323604-elementary
/TaiwanDistrictMap/#/housing/63000/63000020?year=2024&type=apartment
/TaiwanDistrictMap/#/politics/63000/63000020?mode=president
```

主題使用 `admin`、`income`、`school`、`housing`、`politics`。後續路徑依序為縣市代碼、鄉鎮市區代碼、村里代碼或學校 ID；保留前導零及未編定代碼中的英文字母。學校使用既有資料 ID（含學制），不用不唯一的校名。房價止於鄉鎮市區。

`?` 位於 `#` 之後，屬於前端路由，不能使用 `location.search` 讀取。

- 房價：`year=2024|2025`；`type=standard|apartment|elevator_low|elevator_high|house`。
- 政治：`mode=officials|mayor|president`，仍以該層允許的模式正規化。
- 學區：`elementary=false`、`junior=false` 表示關閉學制；省略表示開啟。選校連結會開啟該校學制。

舊的 `income.html`、`school.html`、`housing.html`、`politics.html` 保留相容入口，透過 `location.replace()` 導向根目錄 hash 網址，房價舊 query 也保留。

## 歷史規則

`src/routing/hash-router.ts` 管理瀏覽器歷史；各應用仍持有自己的資料、導覽堆疊及相機。URL 成功還原後才呈現最終狀態，未完成請求受 navigator 序號與清理機制保護。

- 進入下一層使用 `pushState()`。
- 同層選取另一個行政區、村里或學校使用 `replaceState()`。
- 篩選或模式變更替換當層紀錄；同主題的返回／前進保留目前篩選與偏好模式，與既有網站返回行為一致，更新目標層 URL。直接開啟連結則依網址還原。
- 返回、麵包屑、回全臺回到既有父層紀錄；跨祖先切換先回共同祖先，再建立新分支，避免留下舊父層。
- `popstate` 還原畫面；`hashchange` 接收主題連結與手動網址變更。相同事件去重，避免重複請求。
- 直接開啟深層連結會補上父層紀錄，第一次瀏覽器返回就回上一層；回到主題全臺後再返回，回到進入這組紀錄前的位置。
- 重新整理已管理的歷史紀錄不重複補父層。瀏覽器前進恢復該層最後選取的單位。

根入口 HTML 先依 hash 提前下載當前主題與共用地圖核心，再由路由器正常動態匯入該主題。主題 CSS 由各自的 `src/apps/<theme>/main.ts` 引入；提前下載使用 `preload as="style"`，Vite 仍負責套用並等待樣式就緒。其他主題程式、樣式及主題資料不會因首次開啟而下載。相同主題的路由變更重用現有應用；跨主題時先清理舊應用再載入新主題，晚到的舊主題匯入會被請求序號丟棄。相機仍使用 navigator 保存的祖先視角；新應用的第一個 View 直接定位，後續導航與返回維持動畫。

## 分享

「複製分享」複製中文麵包屑標題與目前 URL；剪貼簿 API 失敗時提供手動複製視窗。資料載入或錯誤期間停用分享，避免複製未完成畫面的連結。分享網址本身保持 ASCII，畫面名稱仍為繁體中文。

hash 各路徑不提供獨立的伺服器頁面或社群預覽 metadata；中文分享文字由複製按鈕提供。

## 驗證

`tests/routing.test.mjs` 驗證直接連結、父層歷史、同層替換、跨祖先切換、前進、刷新、query、快速連續切換及清理；行政區／學校測試另驗證原子還原、失效請求、非法代碼、跨區學區及房價行政區選取。

本機以 Pages base 建置，開啟 `http://127.0.0.1:4173/TaiwanDistrictMap/#/school/...` 等連結；檢查直接開啟、重新整理、返回／前進、手機面板、清單搜尋、地圖灰色鄰區切換與舊 HTML 相容入口。

## 首次載入效能

主題程式與 CSS 由目前 hash 動態載入，Vite 會在主題模組啟動前預載其依賴與樣式。HTML 在程式啟動前提供帶 ARIA status 的載入提示；主題 chunk 讀取失敗時提供重試。共享地圖核心仍是主要 JS 資源，且所有主題都需要它。

2026-10-09 以舊、新建置產物對照，在本機對所有 JS／CSS 回應各增加 400ms 延遲並停用 HTTP 快取。390×844 手機 viewport 從文件開始載入到 `#map` shell 建立：修正前 1,318ms，修正後 475ms；約省 843ms。資源時間顯示舊版入口先載入 CSS、再開始主題與 SDK 程式，新版全部由 HTML 同時發起。

這是受控資源延遲測試，不是公開網站的 Core Web Vitals、完整底圖載入時間或所有使用者速度保證；公開網路、快取與裝置效能仍會影響結果。相較學區舊入口所需程式及樣式，新入口 gzip 約增加 15KB，換取少兩輪資源探索與更直接的啟動。測試量測腳本不納入發布產物。

2026-10-09 接著改為主題程式與 CSS 按 hash 分割。在本機 production build 以瀏覽器 asset inventory 冷開 `#/school`，確認只請求學區主題 chunk/CSS、根路由器、共用地圖核心及 worker；沒有載入所得、房價或政治主題 chunk/CSS。以同一 Python gzip level 9 對建置檔估算，舊入口 JS 約 341.7 KB gzip，新學區路由實際載入的 JS chunks 約 330.4 KB，減少約 11.3 KB；CSS 從約 16.6 KB 降至約 14.7 KB，減少約 1.9 KB。共用地圖核心單一 chunk 仍約 320 KB gzip，因此此改動主要避免下載未選主題的程式與樣式，首載改善有限，不會消除外部底圖網路等待。這是建置資源估算及本機瀏覽器檢查，不代表公開網路或實機手機的載入時間。

### 提前探索資源與首次直接定位

`scripts/vite/initial-preload.mjs` 在正式建置的 HTML post hook 收集各主題的實際 chunk、靜態依賴及 CSS，將小型 bootstrap 放在根入口的 charset／viewport metadata 後、stylesheet 前。Bootstrap 對 hash 採與 router 相同的主題、層數及 ASCII ID 規則，非法網址使用行政區主題；依目前主題發起 `modulepreload` 與 CSS preload，同時以 `preload as="fetch" crossorigin="anonymous"` 提早請求 `data/counties.geojson`。網址使用當次 Vite base，支援 Pages 子路徑及相對 base。

資源索引包含五種主題的檔名，但只對目前主題的靜態依賴發出請求；不預載 worker、其他主題、鄉鎮／村里或主題資料。較大的共用核心優先發起。正常啟動仍由原本的 dynamic import 與 repository 執行，預載錯誤不提交應用狀態。瀏覽器會記住失敗的模組下載，因此程式載入失敗的「重試」會重新整理目前 hash，清除失敗模組紀錄；資料失敗仍使用原本的頁內重試。已用一次 chunk 503 驗證重試後恢復全臺畫面及目前網址。Dev server 不套用此建置 hook。

第一個可呈現的 View 使用 0ms 相機定位，包含直接開啟學區／村里分享連結與樣式晚到的情況；若已有預覽則保留原動畫。之後進入、同層切換、返回與保存視角使用原本 duration；學區資料仍在相機停止後更新並保留 180ms 淡入，減少動態效果時維持 0ms。

以修改前 `b1cb999` 與本次實作作 production source 比較：390×844 實際 viewport、每個本機 JS/CSS/JSON/GeoJSON 回應延遲 250ms、gzip、HTTP/1.1。每個主題及版本各三次，全新資源 URL 確保冷載入，同次造訪保留 HTTP 快取。關閉本機 TomTom key 以排除外部底圖變動，保留地圖核心與 SDK 程式，沒有 CPU throttling。中位數如下：

| 主題 | 介面建立（前 → 後） | 界線開始繪製（前 → 後） |
| --- | ---: | ---: |
| 行政區 | 665 → 584ms | 1,054 → 944ms |
| 所得 | 670 → 580ms | 1,064 → 943ms |
| 學區 | 665 → 400ms | 1,845 → 757ms |
| 房價 | 676 → 587ms | 1,069 → 955ms |
| 政治 | 667 → 582ms | 1,277 → 1,191ms |

「介面建立」指 `#map` shell 出現；「界線開始繪製」指 MapLibre render 時行政區來源已完成且 fill 圖層開始揭露，不代表淡入完成或完整底圖就緒。學區約省 1,088ms，包含入口與首次動畫兩個不同階段；其他主題原本已能在動畫中繪圖，開始繪製約省 86–121ms。所有版本的 counties 在每次首載只有一次請求，修改後首次相機 duration 皆為 0。另將主題 CSS 額外延遲 1 秒，確認樣式下載完成後才建立地圖；連續兩次 503 後仍能重試恢復。

這些是受控比較，不是公開 Pages、實機手機或 Core Web Vitals 的速度保證。根 HTML 約增加 0.67KB gzip，換取提前發現資源；大型核心與外部底圖仍是首載成本。回歸包含 `tests/initial-preload.test.mjs` 的路由／base／靜態依賴／CSS preload 測試及圖層初始定位／後續動畫／晚到樣式與預覽測試。瀏覽器另驗證五種正式地圖、手機與桌面、學校／村里深層連結、學校同層切換後 Back 回行政區、清單搜尋、灰色鄰區切換及舊 HTML query 相容轉址。
