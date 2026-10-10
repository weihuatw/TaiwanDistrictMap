# TaiwanDistrictMap 專案交接

更新日期：2026-10-09。本文件整理既有設計決策與實作經驗；數量與驗證結果是該日快照，更新資料後以公開 manifest、檢查腳本及實際程式為準。

## 專案與現況

這是 Vite + TypeScript 的純靜態地圖網站，沒有後端。五個 HTML 入口共用地圖核心與介面：

| 入口 | 用途 | 應用目錄 |
| --- | --- | --- |
| `index.html` | 縣市 → 鄉鎮市區 → 村里行政區瀏覽 | `src/apps/admin/` |
| `income.html` | 2024 年平均年綜合所得地圖 | `src/apps/income/` |
| `school.html` | 國小、國中位置與官方學區地圖 | `src/apps/school/` |
| `housing.html` | 實價登錄住宅成交統計與案件明細 | `src/apps/housing/` |
| `politics.html` | 首長／村里長黨籍與縣市長／總統得票 | `src/apps/politics/` |

- Repository：<https://github.com/weihuatw/TaiwanDistrictMap>，發布分支為 `main`。
- GitHub Pages：<https://weihuatw.github.io/TaiwanDistrictMap/>；另有 `income.html`、`school.html`、`housing.html`、`politics.html`。
- 五個頁面均已部署；最近功能為政治地圖全臺選舉模式與模式跨層級保留。
- `f7c058a` 加入手機底部資訊面板與載入前動畫；`eff2c81` 擴充全臺學校、學區資料並修正新北正規化；`6464a53` 是臺北學區頁的初版。
- `docs/verification.md` 與 `docs/income.md` 仍有早期「尚未部署／等待 Secret」的文字，屬歷史狀態，不能當作目前阻礙。
- 網站、文件及與使用者溝通以繁體中文為主。

## 開始工作

1. 先看 `git status`，保留使用者尚未提交的修改。
2. 本文件提供整體脈絡；需要細節時再讀 `README.md`、`docs/architecture.md`、`docs/income.md`、`docs/school.md`。
3. 一般前端開發直接使用已提交的 `public/data/`，不必重新下載或生成官方資料。
4. 啟動前確認是否已有可用的開發 server。Port 由當次環境決定，不要假設一定是 5173，也不要停止使用者正在使用的 server。

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

需求：Node.js 24 以上、npm；資料管線另需 Python 3、curl。套件版本以 `package-lock.json` 為準，目前 TomTom SDK 為 0.51.3、MapLibre GL 為 6.13.0、Vite 為 8.2.2。

底圖 key 使用 `.env.local` 的 `VITE_TOMTOM_API_KEY`。不要輸出檔案內容或 key，不要提交環境檔。沒有 key 時，本機仍可用官方界線與網格背景操作；正式部署工作流程要求 GitHub Actions 同名 Secret。此前 Secret 已設定並成功部署。

## 網址與瀏覽器歷史

2026-10-09 起由根目錄 `index.html` 與 `src/main.ts` 啟動五個主題，採 `#/admin`、`#/income`、`#/school`、`#/housing`、`#/politics` hash 路由。舊 HTML 保留為相容轉址入口。完整設計見 `docs/routing.md`。

- URL 使用行政區代碼與學校 ID，不使用中文名稱；「複製分享」附中文麵包屑標題。
- `src/routing/hash-router.ts` 管理每層一筆的瀏覽器歷史：下鑽新增、同層切換／篩選替換、跨祖先切換重建分支，直接連結補父層。網站返回、麵包屑與瀏覽器返回遵循相同階層。
- `RegionNavigator.restorePath()`、`SchoolNavigator.restorePath()` 原子還原深層路由，沿用請求序號、重試與相機還原。房價選取也由 navigator 管理。
- query 在 hash 內，以路由解析；不要直接寫 `location.search` 或從 panel 呼叫 `history.replaceState()` 破壞路由歷史。
- 根 HTML 的 build bootstrap 依 hash 提前預載當前主題的靜態依賴、CSS 與 counties，再由路由器正常動態匯入；共用 CSS 靜態載入，主題 CSS 由自己的 `src/apps/<theme>/main.ts` 引入。CSS preload 只提前下載，Vite 仍套用並等待它就緒。不要在 `src/main.ts` 靜態匯入所有主題，亦不要改成先等待 CSS 再下載主題程式的串行流程。
- 同主題路由還原沿用已啟動應用；跨主題先清理舊應用，再載入新主題。`src/routing/theme-app-host.ts` 的請求序號會丟棄晚到的舊主題模組載入；載入失敗要能重試。分享在資料載入及錯誤期間停用。
- 路由回歸見 `tests/routing.test.mjs`。新增主題需同步更新主題路由、啟動器與 shell 連結；舊 HTML 多入口可作相容入口，無須生成各區 HTML。

## 模組責任

| 位置 | 責任與修改時注意事項 |
| --- | --- |
| `src/main.ts`、`src/routing/theme-app-host.ts`、各應用 `entry.ts` | 共用路由啟動器按需載入單一主題；共用 CSS 靜態載入、主題 CSS 隨主題模組載入；舊 HTML 保持為相容轉址入口 |
| `scripts/vite/initial-preload.mjs` | 正式建置時依實際 chunk 產生根 HTML 的 hash 主題 preload；只提前下載目前主題靜態依賴／CSS 及 counties，支援當次 base |
| `src/map-core/create-map.ts` | TomTom 底圖、無 key 預覽、MapLibre worker、縮放與比例尺控制 |
| `src/map-core/boundaries.ts` | 按父層分檔載入 GeoJSON；成功結果快取，失敗不快取，請求逾時 20 秒 |
| `src/map-core/navigation.ts` | 基本與所得頁導覽、歷史視角、灰色鄰區切換、非同步請求序號 |
| `src/map-core/camera.ts` | 三個頁面共用的取景、預覽動畫、取消及返回視角 |
| `src/map-core/settled-update.ts` | 最新更新排程：相機停止後下一幀執行，清理時取消 |
| `src/map-core/region-layer.ts` | GeoJSON 填色／輪廓、灰色背景區域、獨立強調外框、點擊命中、避讓標籤；MapLibre `style.load` 後即可加入行政區圖層，不等底圖圖磚與字型全部載入；不查詢頁面元素 ID |
| `src/map-core/types.ts` | 行政區、View、Camera、Padding 等共用型別 |
| `src/ui/map-shell.html`、`map-shell.ts`、`style.css` | 清單、搜尋、麵包屑、提示、來源視窗及手機資訊面板；不持有資料載入或導覽歷史 |
| `src/data/population.ts` | 共用人口資料 manifest、村里／各層彙總與單一年齡分片 repository；不耦合主題或地圖幾何 |
| `src/apps/*/main.ts` | 引入該主題 CSS，組合核心、介面及主題回呼，處理主題資訊；行政區主題的跨主題資訊卡由 `src/apps/admin/facts-panel.ts` 讀取各主題 repository |
| `src/apps/income/main.ts`、`panel.ts` | 所得頁選舉政黨傾向互斥控制、路由還原及 PoliticalRepository 整合；不寫回界線 GeoJSON |
| `src/apps/school/navigation.ts` | 獨立 `SchoolNavigator`；`polygonView()` 將學校狀態轉成共用 polygon View；比較模式選校保留相機 |
| `src/apps/school/data.ts`、`markers.ts` | 學校分檔、學區里界載入與學校標記 |
| `src/apps/housing/` | 房價統計、行政區導覽及選取後載入成交明細 |
| `src/geometry.mjs` | 前端及資料生成共用的幾何、行政區代碼、資料路徑工具 |
| `scripts/` | 官方資料下載、解析、生成與驗證；不包含在前端 |

底圖與主題資料相互獨立。行政區／學區使用 TomTom `standardLight`，所得使用 `monoLight`；語言 `zh-Hant`，不載入交通等選用模組。填色與線段放在底圖 symbol 文字圖層下方。

新增主題應建立 `src/apps/<主題>/`，更新路由、`src/main.ts` 啟動器與 shell 連結；若需相容 HTML 入口，再更新 `vite.config.ts` 的多入口設定。共用圖層透過 `getColor`、回呼及設定取得主題資訊，不直接耦合學校或所得資料。

不要修改共用快取中的官方 feature 來儲存主題狀態。呈現用屬性與 `polygonView()` 的學區 focus bounds 都以複本建立。`RegionLayerOptions.contextOpacity` 與 `contextHoverOpacity` 可調整各主題周邊行政區的填色透明度。

## 必須保留的導覽與手機體驗

- 基本／所得頁逐層選區，村里可選取高亮；周邊及同層其他區域保留為灰色，可切換。
- 返回與麵包屑恢復先前視角，首頁重設全臺範圍。
- 載入前可開始地圖轉場，但資料、導覽路徑與選取狀態要等成功後才提交。
- 請求序號確保較新的選取勝出。返回、回首頁、變更學校 filter、清理頁面都必須讓舊請求失效；舊請求不能覆寫新畫面或解除新請求的 loading。
- 載入失敗可重試，失敗或取消預覽需回復預覽前的相機。連續預覽仍保存第一個預覽前的視角。
- 保留鍵盤操作、ARIA、`prefers-reduced-motion`；減少動態效果時動畫 duration 為 0。
- 清理應用時解除事件、取消待執行更新、移除 marker／map；HMR 或晚到請求不得更新已銷毀的 DOM。

手機 breakpoint 為 760px。資訊面板位於底部，內容可捲動，展開高度約 38dvh；可點 handle 或上下拖曳收折，收折後只露 handle 與 safe area。收折內容設為 `inert`，避免隱藏按鈕仍可取得焦點。拖曳後要抑制隨後的 click，但不能讓 Enter／空白鍵失效。

所得圖例與選取卡片在手機移入可捲動資訊區，桌面保留原位置。`--info-visible-height` 用於控制比例尺等底部元素的避讓；面板尺寸／轉場會更新避讓與標籤，不應每次選取都強制展開面板。

### 縮放修正的經驗

這部分在三個頁面共用，修改必須一起檢查：

- **學校位置預覽只平移，保持當前 zoom**。不要再次強制 zoom 14：官方學區可能很大，先放大到校址再按學區縮小會造成反覆彈開。
- 學區完整載入後，才依所有學區里界及校址一次取景，包含跨行政區的範圍。`polygonView()` 不可只用學校所在行政區 bounds。
- 目前使用 `cameraForBounds(bounds, { padding, absolutePadding: true, maxZoom })` 算出目標，再 `easeTo()`，將相機 padding 清為零並以 `offset` 避開面板。Offset 為 `[(left-right)/2, (top-bottom)/2]`。
- MapLibre 6.13 的預設 bounds padding 會加在相機已有的 padding 上。不要保留前次 padding 再重複加入，否則可用空間越算越小，手機尤其明顯。
- 使用 `easeTo()` 讓 zoom 直接插值；一般 `fitBounds()` 預設的 `flyTo()` 可能為飛行弧線先縮小，需避免再引入縮放反轉。
- 村里概覽、學區及 detail 的 maxZoom 為 16；全臺／縣市相關概覽為 14。小區域不應一律被限制在 14。
- 相同預覽與最後取景不用重新啟動動畫。去重鍵需包含 bounds、maxZoom、padding；資訊面板高度改變時仍要更新取景。
- 第一個 View 直接定位（duration 0），包含深層連結及晚到樣式；既有預覽、後續進入／同層切換／返回保留動畫與先前視角。不要重新引入學區首載等待 720ms 取景動畫才畫界線。
- 地圖 resize 可重新 fit；預覽未完成時不能被舊 View 的 resize fit 打斷。

相關回歸測試集中在 `tests/transition.test.mjs`。

學區頁啟用 `deferUntilMoveEnd` 與 180ms 淡入：資料下載和相機動畫並行，但 GeoJSON、標籤與學校 marker 在相機停止後才更新。以 `moveend` 加 `isMoving()` 重查排程，不用固定等待時間或全域 `idle`；僅確認行政區來源已載入才揭露新圖形。淡入用 MapLibre 圖層透明度，不逐幀重送 GeoJSON；減少動態效果時關閉淡入。實際顯示資料和待更新資料分開，等待時禁止舊 polygon 命中。所有頁面的標籤避讓僅在相機停止後執行，集中讀取尺寸再寫樣式。排程與圖層回歸見 `tests/region-layer.test.mjs`。

## 行政區資料

來源是內政部國土測繪中心官方全國主圖層，轉成 WGS84 並做共邊拓樸簡化。行政區代碼一律保留字串、前導零及未編定範圍的英文字母。

2026-10-08 快照：22 縣市、368 鄉鎮市區、7,986 村里圖形，其中 206 是未編定範圍。縣市／鄉鎮版本為 1140318，村里版本為 1150817。展示圖形數不能直接當作正式村里數。

- `data/raw/`：忽略的原始 ZIP、SHP 及補充檔。
- `data/sources.json`：來源、版本、下載識別及雜湊。
- `public/data/counties.geojson`、`towns/{COUNTYCODE}.geojson`、`villages/{TOWNCODE}.geojson`：按需載入。
- `public/data/manifest.json`：公開版本與處理參數。

概覽 `focusBounds` 聚焦臺灣周邊，避免南海等離散圖形讓區域過小；原始完整幾何仍保留。村里 detail 原則上用完整 `bounds`，但若遠離臺灣周邊的離散島礁大幅拉開 bounds，取景改用 `focusBounds`，不得因此刪除合法離島幾何。全臺初始範圍包含本島、澎湖、金門、馬祖。

官方補充 `Town_Majia_Sanhe`／`Village_Sanhe` 與主圖層重疊，目前保留原始下載，不混入全國主圖層。簡化距離依序為 90／35／10 公尺，座標保留六位小數；展示資料不是測量成果。

```sh
npm run data:fetch
npm run data:build
npm run data:check
```

重新下載前核對官方版本及 URL，勿把詮釋資料更新日當作行政區生效日。界線重建必須保留 `public/data/income/`、`public/data/school/` 等主題輸出；更換界線後重新對照、檢查各主題。

## 所得資料

財政部 113 年度綜合所得稅申報初步核定統計，所得年度為 2024，發布日 2026-06-30。來源詳見 `docs/income.md`。

- 指標是綜合所得總額 ÷ 納稅申報戶數，呈現為萬元／申報戶／年；不可混用「總所得」或「所得淨額」，也不是個人薪資／可支配所得。
- 全臺合計用總額及戶數加權；行政區以該層官方合計優先。中位數只用該層官方數字，不平均下層中位數。
- 級距固定為 55、65、75、90、110、150 萬元切點，全國各層一致，不因縮放重新分級。所得透明度固定，滑過／選取強調輪廓。
- 對照以縣市＋行政區＋村里名稱及明列字形別名完成，不模糊比對、不將舊里所得任意分配到新拆分的里。
- 目前 7,734 村里對應、申報戶數覆蓋 99.76%；46 個具名村里及 206 個未編定範圍未對應，顯示斜紋「無資料」，不是零。
- 官方「其他」納入上層總額，但不代表未編定 polygon。

```sh
npm run income:fetch
npm run income:build
npm run income:check
```

Python 標準函式庫解析官方 HTML，需注意嵌套表格，不能漏掉內層行政區或外層第一筆村里。戶數逐層合計必須一致；所得總額允許官方千元捨入差。

原始下載在 `data/raw/income/113/`；來源在 `data/income/sources.json`；公開輸出與對照報告在 `public/data/income/2024/`。

## 村里人口資料

使用內政部戶政司村里戶數及單一年齡人口資料，呈現戶籍人口，不能稱為常住人口。完整來源、代碼對照、更新流程及讀取介面見 `docs/population.md`。

- `src/data/population.ts` 是主題無關的讀取介面，提供村里、鄉鎮、縣市、全臺彙總及單一年齡性別資料。不要把人口欄位寫回共用 GeoJSON，也不要讓只需要總人口的頁面下載年齡分片。
- 行政區頁透過共用 shell 的 `infoExtra` 插槽，將人口接在原本資訊面板下方；全臺、縣市、行政區及村里均顯示目前範圍的總人口，可展開男女與戶數或收折只留總數。區域切換保留展開狀態；載入失敗可重試，較舊的選取請求不得覆寫新狀態。
- 行政區頁的資訊卡另整合 2024 所得、住宅成交統計、村里官方學區學校及政黨資料。每張卡各自收折並以單行摘要呈現；學區只在具名村里顯示，逐校列出國小／國中、學年度、部分鄰／共同學區註記與官方來源。房價在村里層級明確標示所屬鄉鎮參考，不當作村里價格。各卡沿用主題 repository、`BASE_URL` 與最新請求序號，不把資料寫入共用 GeoJSON。
- 11508 基準有 7,781 筆官方村里資料；7,780 個具名界線皆對應，瑪家鄉三和村代碼 `10013280006` 有人口但未混入全國主圖層，206 個未編定範圍沒有村里人口。來源名稱有 23 筆字形差異，依代碼連接並保留報告。
- 原始檔在忽略提交的 `data/raw/population/`，來源與 SHA-256 在 `data/population/sources.json`，預期例外在 `data/population/expected-exceptions.json`，輸出在 `public/data/population/{西元年月}/`。

```sh
npm run population:fetch -- 11508
npm run population:build -- 11508
npm run population:check
```

發布 CI 執行 `population:check`；原始 CSV 不必放入 CI。月份更新後要檢視對照報告並審核例外清單。

## 學校與學區資料

學區頁仍保留縣市 → 行政區 → 第三層互動，但**進入行政區顯示學校位置，不先畫所有里**。選校後才載入該校學區的里。國小／國中兩個 checkbox 預設皆 checked，兩者都關閉時顯示明確空狀態。國中部與國小部獨立記錄，同位置 marker 並排。

學區頁另有互斥的「學區／所得／房價」著色模式。所得在縣市、鄉鎮及村里層級分別按同層官方數值著色；選定鄉鎮的學校畫面只顯示該鄉鎮各里的所得，周邊行政區保留灰色且可點選切換。房價依現有資料按縣市或鄉鎮市區著色，村里畫面仍以其所屬鄉鎮房價著色，不代表里別價格；學校畫面可點選其他鄉鎮切換。所得／房價比較模式使用 TomTom `monoLight`，學區模式使用 `standardLight`；切換樣式後共用區域圖層會在新 style 載入時重建。比較模式選校時保留視角，以白色外框加深藍色細線標示涵蓋里界的聯集外框，學區內部仍顯示原始里界，並提供查看完整學區的按鈕。選校資訊卡的所得採可對應涵蓋里申報戶數加權平均；房價逐列顯示涵蓋里所屬鄉鎮的中位數，不合併為學區房價。模式寫入學區路由 `map` query，直接分享可還原；瀏覽器返回到未帶模式的舊階層時沿用目前模式。無資料及樣本不足沿用斜紋／灰色狀態，滑過區域顯示數值與房價統計層級。

所得頁「顯示政黨傾向」可互斥選取 2024 總統或 2022 縣市長選舉；取消目前選取即可移除標記。縣市、鄉鎮、村里各自載入同層選舉結果，將小型彩色 Unicode 方塊接在行政區名稱後方；色彩取該層最高票候選人的推薦政黨，並列以紫色表示，缺漏／部分票不畫標記。選項寫入所得路由 `party` query，資料由 `PoliticsRepository` 按當前層級分片載入。`RegionLayerOptions.getLabelAdornment` 提供通用文字附加項，資料抵達後呼叫 `refreshLabels()` 原位更新標籤，不另建地圖點位圖層，也不應建立大量 DOM marker。

學校位置來自教育部名錄，以國土測繪中心校地代表點及官方校園位置補足。學區來自各縣市官方 CSV、ODT、PDF、教育處或學校公告，保留來源、原文、備註及每校學年度；不可用最近學校或距離推估官方學區。

2026-10-08 快照：

- 22 縣市均可查看學校，共 3,665 筆學校／學部記錄：國小 2,712、國中 953。
- 3,290 筆有官方學區記錄，其中 3,231 筆有可顯示的村里幾何。這不是全臺學區完整收錄。
- 嘉義縣為 24／148 筆有學區、連江縣為 2／12，仍是主要資料缺口。
- 學年度包含 112、114、115 及未註年度來源；不能把所有學區都標成 115 學年度。
- `catchment: null` 表示「學區未收錄」；有公告但沒有村里對照表示「尚無里界對照」。兩種狀態必須區分。
- 只要部分鄰屬於學區，第一版畫完整村里，保留 `partial`／`shared` 註記。整里填色不等於全里都屬於該校。
- 無法唯一對照的村里列於面板及報告，保留官方原文；已有部分幾何不能冒充完整學區。

### 解析及對照的經驗

- `scripts/school/parse-national.py` 依來源格式擷取資料；`national.mjs` 連接學校；`village-links.mjs` 依行政區語境解析村里。共同學區也可能跨行政區或縣市。
- 新北國中原文「德安(18-28鄰，車子路以南)、小城、吉祥、玫瑰、明城、達觀、雙城、日興、香坡等里」省略每個名稱的「里」。需以 `omitVillageSuffix` 對照正式里名，不能只辨識帶「里」的共同學區文字。
- Unicode NFKC、移除空白、台／臺正規化後仍要考慮完整行政區語境、最長行政區名稱與唯一候選，不能只按全臺同名村里匹配。
- 共同學區括號中的其他學校行政區描述，不應改變後續村里的對照語境；來源原文保留，語境分析另行遮罩相關文字。
- PDF 表格常有跨頁標題、合併欄位、學校分部；Word 輸出的 PDF 還會有文字背景矩形。表格邊線辨識應排除背景方塊，不要假設一般 `extract_tables()` 能完整還原。
- 鄉鎮欄位若在 PDF 換頁後空白，不可沿用前一頁最後一個鄉鎮；以學校正式位置補本地語境，原文明列的跨鄉鎮範圍仍依原文對照。
- 官方原文出現全縣、縣級自由學區／大學區，或明確開放全縣設籍學生就讀時，才將該縣村里標為共同／自由範圍。只有「可不受一般學區限制」的招生順位說明要連同招生對象條件判讀；沒有明確里界或可辨認範圍時不可猜測。
- 行政區沿革、字形異體或官方表格誤植，只有能由同一鄉鎮正式里名唯一確認時才加 `data/school/aliases.json` 的 scoped village alias；允許一個舊名對應多個改制後里，禁止模糊匹配。
- 校名與學制精確對照，明確別名放在 `data/school/aliases.json` 等既有映射，不任意相似比對；保留附設學部代碼。
- 校地 119／121 分帶資料先轉 WGS84；多個校地的代表點選擇及人工補充需保留來源，不憑行政區中心捏造校址。
- 新北達觀國中部九里、省略後綴、道路／鄰切分、共同學區語境有回歸測試，修改解析器時要保留。

### 重建與補資料

```sh
python3 -m venv .venv-school
.venv-school/bin/pip install -r scripts/school/requirements.txt
export SCHOOL_PYTHON="$PWD/.venv-school/bin/python"
npm run school:fetch
npm run school:parse
npm run school:build
npm run school:check
```

`school:fetch` 不包含解析；PDF／ODT／HTML 解析需 `lxml`、`pdfplumber`，版本在 `scripts/school/requirements.txt`。已有完整輸出時，前端修改不用執行整個下載流程。

- `data/raw/school/`、`data/build/school/`、`.venv-school/` 均忽略，不提交。
- `data/school/` 保存來源、下載紀錄、教育部名錄、別名與 `site-rows.json`／`site-sources.json` 等官方網站補充。
- `public/data/school/towns/{TOWNCODE}.json`：368 個行政區分檔。
- `public/data/school/villages/{TOWNCODE}.json`：村里到學校的反向索引；學校可跨鄉鎮設籍，因此村里學區查詢需透過此索引，再讀取學校所在鄉鎮分檔。`school:build` 會一併生成，僅重建索引可用 `node scripts/school/build-village-index.mjs`。
- `public/data/school/manifest.json`、`join-report.json`：逐縣覆蓋率、年份、來源及未對照項目。
- `discover-school-sites.py`、`fetch-chiayi-backgrounds.py` 是額外來源探索工具，不在一般 npm fetch 流程中。取得網頁／PDF 不等於已完成學區對照；補充前確認明確官方學區原文，登錄來源後再 build/check。
- 解析器會快取 `data/build/school/*-tables.json`。換來源或改表格擷取時，檢查對應快取是否需要重建，避免一直讀舊解析結果。

前端 `SchoolRepository.catchment()` 根據學區村里的所有 `townCode` 載入界線，而不是只讀學校所在區；必須驗證載入的里數等於唯一里代碼數。

## 實價登錄房價資料

房價頁 `housing.html` 使用內政部地政司買賣批次資料，現有快照呈現 2024、2025 年住宅交易，依縣市及鄉鎮、住宅型態提供單價中位數、樣本數與成交明細。免費批次沒有座標；不可從門牌推導點位，也不可把鄉鎮統計當成村里或個案價格。完整來源、篩選及限制見 `docs/housing.md`。

- `scripts/housing/fetch.py`、`build.py`、`check.mjs` 負責批次下載、整理及檢查；前端修改不需重新下載。
- `data/housing/sources.json` 記錄下載來源；原始檔在忽略的 `data/raw/housing/`。
- `public/data/housing/` 是部署用摘要、案件分片及報告；選取行政區後才載入該區明細。
- 重建命令：`npm run housing:fetch`、`npm run housing:build`、`npm run housing:check`。發布 workflow 必須保留 `housing:check`。

## 政治資料

`politics.html` 已發布；詳見 `docs/politics.md`。

- 官方首長／村里長名錄與歷史參選推薦政黨獨立，不能以中選會歷史 `is_current` 當現任。內政部 ODS 匯出實際是 XLS，而且含歷屆；只選本屆、衝突留白，公開資料不含聯絡資訊。
- 全臺下拉選單為「各縣市首長黨籍」、「2022 縣市長得票」、「2024 總統得票」；選取的模式跨層級及返回時維持，只在該層無此模式時採該層預設。全臺選舉模式依各縣市自己的選舉結果著色並列出領先政黨分布，不彙成全臺單一勝選黨。縣市內顯示鄉鎮原始候選人得票最多者政黨；村里可切換本屆村里長與兩種得票。無黨籍逐人比較，不能相加為單一政黨；並列、未知與鄰區各有圖例。
- 2022 嘉義市使用 12-18 重行選舉。2024 總統／副總統兩列共用一張票，只計一次。投票率分母為中選會選舉人，不是戶籍人口。
- 22 首長與兩種選舉的 368 鄉鎮皆有紀錄；具名村里 7,780 中，本屆名錄唯一對照 7,649、兩種選舉各 7,713。2024 中另 86 里有部分合併票，保留明細但顯示斜紋、不判定全里最高票；歷史拆併、連江合併列示不分攤。
- `scripts/politics/{fetch,build,check}.py`；來源、字形別名、配色、逐筆補充及預期例外在 `data/politics/`。原始檔及 `.venv-politics/` 忽略。build 用 xlrd，check 僅用 Python 標準函式庫與公開分片。
- `official-overrides.json` 記錄代理／黨籍變更與斗南漏里名補充；更新月份／取得日之前重新查核。不得自動更新例外清單掩蓋覆蓋率退步。
- `PoliticsRepository` 獨立於 GeoJSON、模式資料分開快取與驗證；成功資料按行政區分檔。清理、導航、舊請求及模式相機行為沿用共用核心，人口重用 `PopulationRepository`，資訊在同一可收折面板。

```sh
npm run politics:fetch
POLITICS_PYTHON=.venv-politics/bin/python npm run politics:build
npm run politics:check
```

## 驗證方式

對程式／資料修改執行適當回歸，完整發布檢查如下：

```sh
npm test
npm run data:check
npm run income:check
npm run school:check
npm run housing:check
npm run population:check
npm run politics:check
npm run build
git diff --check
```

2026-10-09 首載更新後全套為 105 個 Node 測試、12 個 Python 測試通過。Node 直接載入可剝除型別的 TypeScript：測試會 import 的模組不要新增需轉譯的 enum 或 constructor parameter properties。建置包含 TypeScript 檢查。

| 測試 | 主要涵蓋 |
| --- | --- |
| `tests/navigation.test.mjs`、`boundaries.test.mjs` | 導覽、快取、競態、返回、失敗重試及清理 |
| `tests/transition.test.mjs` | I/O 前預覽、單次縮放、padding、返回／取消、手機面板高度變化 |
| `tests/initial-preload.test.mjs`、`region-layer.test.mjs` | build preload 的目前主題／靜態依賴／base／CSS 等待、首次直接定位、後續動畫、晚到樣式及更新排程 |
| `tests/school.test.mjs`、`school-data.test.mjs` | 第三層學校模式、filter、跨區學區、解析與里名語境 |
| `tests/income.test.mjs`、`income_parser_test.py` | 指標、路徑、級距、缺漏及嵌套 HTML |
| `tests/population.test.mjs`、`scripts/population/check.py` | 人口分片快取／重試、年月、村里代碼、年齡與行政區加總 |
| `tests/politics.test.mjs`、`politics_parser_test.py`、`scripts/politics/check.py` | 模式／路徑、最高票與並列、缺漏／部分票數、快取重試、正副總統不重複計票及逐層加總 |

瀏覽器驗證至少包含改動相關頁面、桌面及 390×844 手機、逐層進入與返回、連續選取、清單搜尋及灰色鄰區切換。改共用核心／介面時要回歸三個頁面。資料載入轉場可使用可控的延遲 server 驗證，避免只測快取命中。

在 Codex 有 CUA 時，瀏覽器操作用 CUA，測試留在背景，結束清除 viewport 覆寫及自建臨時分頁／server，保留使用者分頁。手機新分頁開啟後需確認實際 viewport；不要只假設前一頁的覆寫仍生效。動畫中的 marker 會移動，精確選校可用清單按鈕；定位文字時注意地圖標籤與清單同名造成多重匹配。

套件造成共享 bundle 超過 500 kB 的建置提示目前已知，建置仍成功；不要把提示誤判為失敗，也不要為無關小修順便重構依賴。

## GitHub Pages 發布

使用者要求發布時，完成修改、相關測試及提交後推送 `main`；不能只說已觸發部署就宣告上線。

`.github/workflows/deploy-pages.yml` 在 main push 或手動觸發時：Node 24／Python 3.13 → `npm ci` → 測試與六種資料檢查 → 確認 key Secret → 使用 `/TaiwanDistrictMap/` base 建置 → 上傳 `dist/` → 部署。Pages Source 為 GitHub Actions。

```sh
npm run build -- --base /TaiwanDistrictMap/
npm run preview -- --base /TaiwanDistrictMap/ --port 4173 --strictPort
```

本機發布路徑驗證應開啟 `http://127.0.0.1:4173/TaiwanDistrictMap/`，並檢查另外兩個 HTML 及分層資料能載入。前端資料 URL 使用 `import.meta.env.BASE_URL`，不可硬寫 `/data/` 破壞子路徑部署。

- 提交來源與 `public/data/` 生成資料，不提交 `.env.local`、原始下載、中間檔、`node_modules/`、`dist/`。
- Secret 僅在建置注入，前端 key 本來就會出現在瀏覽器請求中；維持專用 key 的網域／產品限制，不把 key 值寫進文件或 log。
- 可用 `gh run list --workflow deploy-pages.yml --limit 3 --json databaseId,status,conclusion,headSha,url` 找當次工作，再以 `gh run watch <run-id> --exit-status` 等待成功。
- 比對 `headSha`，使用 `--commit` 時給完整 SHA；短 SHA 曾無法查到工作。
- 部署成功後刷新公開頁面並實測相關操作，避免瀏覽器仍保留舊 bundle。回報網址及 commit，若有資料收錄限制則如實描述。

當前環境若限制 `.git` 寫入或網路，commit／push／gh 可能需要執行工具權限升級；遵循當次環境政策，不把這當作專案尚未設定好的問題。

後續修改資料規則、核心架構或部署流程時同步維護本文件；不要記錄暫時的工具 session ID、瀏覽器 tab ID 或 key 值。
