# 全臺學校與學區地圖

入口：[school.html](../school.html)。縣市 → 鄉鎮市區 → 學校；行政區層級顯示學校位置，選校後才載入相關村里界，保留返回視角與灰色鄰區切換。國小、國中兩個 checkbox 預設皆勾選。

## 收錄與限制

全臺 22 縣市皆可查看學校。位置主要來自教育部公開地理資訊名錄，並以國土測繪中心校地內部代表點及官方校園點位補足。國中部與國小部各自為一筆資料，重疊位置標記並排。

學區由各縣市官方 CSV、ODT、PDF、教育處網頁及學校公告對照；每校保留學年度、來源與原文。**全臺 22 縣市的學校位置可查看，學區仍有缺漏，尤其嘉義縣與連江縣只有部分學校取得明確村里對照。**未取得學區者顯示「學區未收錄」；有公告但沒有里界對照者顯示「尚無里界對照」。沒有使用距離或最近學校推估。

學區表涵蓋 112、114、115 學年度；苗栗的動態學區查詢及未註學年度的學校頁保留為未註學年度資料。資料版本與目前行政區界不一定一致，新增、變更或無法唯一識別的村里記錄在對照報告。完整逐縣數量見公開的 [manifest.json](../public/data/school/manifest.json)，缺漏及別名見 [join-report.json](../public/data/school/join-report.json)。

部分村里無法唯一對照時，選校面板會列出未完成對照的名稱並保留官方原文，已畫出的里界可能不完整。

只要部分鄰屬於學區即標出完整村里，保留部分鄰與共同學區註記。整里填色不代表全里都屬於該校。跨行政區、跨縣市的村里依明確行政區語境對照並載入對應里檔。

新北市國中「德安、小城、吉祥……等里」等省略「里」字的名單會正規化成正式里名。共同學區備註中的其他學校行政區不會改變下一個村里的對照語境。達觀國中部的九個里及道路切分案例已納入回歸測試與資料檢查。

## 重建

Node.js 與專案套件沿用原專案；PDF／ODT／網頁解析另需 Python 套件。

```sh
python3 -m venv .venv-school
.venv-school/bin/pip install -r scripts/school/requirements.txt
export SCHOOL_PYTHON="$PWD/.venv-school/bin/python"
npm run school:fetch
npm run school:parse
npm run school:build
npm run school:check
npm test
npm run build
```

原始下載在已忽略的 `data/raw/school/`，解析中間檔在 `data/build/school/`。下載日期、SHA-256、URL 及學年度記錄在 `data/school/`。學校官網補充的村里對照以 `site-rows.json` 保存，來源在 `site-sources.json`；更新前須重新核對來源原文。

教育部名錄使用其公開學校搜尋表單查詢國小、國中，保留學校代碼與附設學部代碼後綴。校地使用 119、121 分帶圖資轉成 WGS84。校名依縣市、行政區與學制精確匹配，明確別名保存於 `aliases.json`，不任意以相似校名替代。

公開學校資料為 `public/data/school/towns/{TOWNCODE}.json`，368 個行政區各有檔案，前端依需求載入與快取。`public/data/school/villages/{TOWNCODE}.json` 是村里到學校的反向索引，包含跨鄉鎮設校的學區；村里資訊卡藉此完整列出涵蓋該里的學校。`school:build` 會一併產生索引，只需重建索引時可執行 `node scripts/school/build-village-index.mjs`。國小、國中學校代碼與學部共同構成識別鍵。

## 驗證

資料檢查驗證每筆學校的識別、來源、位置與行政區關係，每個學區里代碼與名稱，以及逐縣收錄數量。臺北市原有 212 筆學區對照保留。來源尚未匹配的學校與村里會列出，不冒充完整收錄。

導覽測試涵蓋學校層級不載入所有里界、返回視角、空篩選、取消隱藏學校、跨區學區、競態及重試。資料解析測試涵蓋跨縣市、省略村里後綴、共同學區備註與行政區語境。
