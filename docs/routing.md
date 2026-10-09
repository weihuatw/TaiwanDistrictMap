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

切換主題按需載入模組，先清理舊應用。相機仍使用 navigator 保存的祖先視角；新連結無相機紀錄時依資料範圍取景。

## 分享

「複製分享」複製中文麵包屑標題與目前 URL；剪貼簿 API 失敗時提供手動複製視窗。資料載入或錯誤期間停用分享，避免複製未完成畫面的連結。分享網址本身保持 ASCII，畫面名稱仍為繁體中文。

hash 各路徑不提供獨立的伺服器頁面或社群預覽 metadata；中文分享文字由複製按鈕提供。

## 驗證

`tests/routing.test.mjs` 驗證直接連結、父層歷史、同層替換、跨祖先切換、前進、刷新、query、快速連續切換及清理；行政區／學校測試另驗證原子還原、失效請求、非法代碼、跨區學區及房價行政區選取。

本機以 Pages base 建置，開啟 `http://127.0.0.1:4173/TaiwanDistrictMap/#/school/...` 等連結；檢查直接開啟、重新整理、返回／前進、手機面板、清單搜尋、地圖灰色鄰區切換與舊 HTML 相容入口。
