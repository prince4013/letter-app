# CLAUDE.md — 手寫信（暫名 letter-app）

> 給在這個 repo 工作的 Claude 看的說明。**所有回覆、註解、文件一律使用繁體中文。**

## App 目的

把手寫的字變成電子檔，產生一個網址，讓對方點開時像收到一封親手寫的信。

- 只給兩個人用：寄信者本人（Lucas）和晴子。
- 獨立於「橘語」app 之外（不同 repo、不同 Render 服務、不同 Supabase 專案）。
- **不需要登入系統**。信件靠不可猜的隨機網址保護。
- App 名稱尚未決定（不是「晴話」）。決定前程式與文件都沿用暫名 `letter-app`／「手寫信」。

## 使用情境

| 誰 | 怎麼寫 | 處理方式 |
| --- | --- | --- |
| Lucas | 電子筆記本，匯出**透明背景 PNG** | 勾選「已是透明背景，略過去背」，只做染色與合成 |
| 晴子 | 白紙＋深色筆手寫後拍照 | 走去背流程。上傳頁提示：白紙、深色筆、光線均勻 |

## 寄信流程（MVP 範圍）

1. 上傳手寫圖片 → 裁切
2. 選信紙顏色（橫條格式，預設三色）、信封樣式（預設三款）、填寫署名
3. 按「預覽」
4. 瀏覽器 canvas 處理：保留墨水、去除背景，合成到所選信紙；深色信紙時墨水自動改淺色
5. 預覽時就能下載；按「寄出」後產生不可猜的隨機網址（`/l/<token>`）
6. 收信者打開網址：先看到橫向信封（寫著署名）與中間的「拆信」按鈕
7. 按下後卡片從信封滑出的動畫，接著呈現信的內容
8. 收信者可「收下存檔」（下載圖片）或「回寄」（走同一套寄信流程；各封信獨立，不記錄回覆關係）

**MVP 之後再說**：多頁信、自訂信紙、App 正式命名與品牌樣式。

## 技術架構

```
瀏覽器（手機為主）                              Flask（Render）            Supabase（新專案）
compose：上傳→縮圖→裁切→去背→合成 PNG ──POST──▶ /api/letters ─────────▶ Storage（私有 bucket）
open：/l/<token> 載入畫面 ──GET──▶ /api/letters/<token>(.png) ◀──────────── Postgres（letters 表）
```

- **去背／合成全部在瀏覽器 canvas 完成**，不用 AI 去背，後端只收最終合成好的 PNG。
- 上傳後先把照片縮到寬度約 2000px（iPhone Safari canvas 面積限制），見 `static/js/image.js` 的 `MAX_WIDTH`／`MAX_PIXELS`。
- 去背演算法（`static/js/ink.js`）：
  1. 轉灰階
  2. 估計紙面背景：分塊取最亮值（把墨水去掉）→ 模糊 → 雙線性放大
  3. 灰階 ÷ 背景，消除陰影與光線不均
  4. 門檻值（含柔邊）→ 墨水 alpha；紙面透明、墨水不透明
  5. 保留墨水原色（藍筆就是藍色）：除以紙面亮度後，把筆畫邊緣依實心筆畫深度還原
  - 透明 PNG 模式：直接沿用原圖 alpha 與顏色
  - 筆跡濃淡滑桿已拿掉（2026-10-13 使用者要求），固定用預設門檻
- 信紙（`static/js/paper.js`）：橫條格式。淺色信紙保留原本筆色（原色太淺才改深色），深色信紙墨水自動改米白。
- 後端：Flask，`app.py` 單檔。部署沿用橘語路線：GitHub → Render，`Procfile`：`web: python -m gunicorn app:app`。
- 資料：有設定 `DATABASE_URL` 用 Supabase Postgres，否則退回本機 SQLite；有設定 `SUPABASE_URL`＋`SUPABASE_SERVICE_KEY` 時圖片存 Supabase Storage，否則存本機 `instance/letters/`（只適合本機開發）。
- 圖片一律經由 Flask 轉送（`/api/letters/<token>.png`），bucket 可設為私有，過期檢查也只在後端做一次。
- 信件網址：`secrets.token_urlsafe(16)`（約 22 字元），不可猜。
- 保存期限：預設 14 天（使用者 2026-10-13 指定）（`LETTER_TTL_DAYS`），過期顯示「已過保存期限」並在下次寄信時順手清掉。
- Render 免費方案會休眠：拆信頁先顯示「信件準備中」載入畫面，資料與圖片都到齊才顯示信封。寄信頁打開時會先打 `/healthz` 把伺服器叫醒。

## 目錄結構

```
app.py                 Flask 後端（路由、資料庫、Storage）
templates/compose.html 寄信頁（上傳→裁切→選樣式→預覽→寄出）
templates/open.html    拆信頁（載入畫面→信封→拆信動畫→信）
static/css/style.css   共用樣式與配色 token
static/js/image.js     讀檔、縮圖
static/js/crop.js      裁切框
static/js/ink.js       去背（墨水萃取）與染色
static/js/paper.js     信紙與信封的樣式定義、合成
static/js/stamps.js    信封印章圖案
static/js/compose.js   寄信流程
static/js/open.js      拆信流程
tests/                 後端 pytest
```

## 預設配色（暫定，待使用者確認）

信紙（橫條）：
- `cream` 奶油白 `#FBF6EA`，線 `#E3D5BC`，墨水深藍黑 `#2B2D42`
- `blush` 淡藍 `#E8F1F8`，線 `#C6D8E8`（代號沿用 blush，舊信件不受影響）
- `night` 夜空藍 `#26324D`，線 `#3E4C6E`，墨水自動改米白 `#F4ECDC`
- 淺色信紙（cream、blush）保留墨水原色

信紙大小**跟著字的範圍走**（不留大片空白，最小 900×560），字**置左、置上**。拆信頁的信封比例跟著信紙比例調整；讀信時可放大縮小（按鈕或點兩下）。

信封（素色，使用者 2026-10-13 指定，依參考圖去掉灰色）：`blue` 淺藍、`pink` 粉紅、`cream` 米黃、`peach` 杏橘、`yellow` 鵝黃、`green` 淺綠。
信封只在左上寫「收件人」，不顯示放件人（2026-10-13 使用者要求刪除）。封蠟（拆信按鈕）是圓形月桂浮雕，寄信時可選三色：`red` 深紅（預設）、`bronze` 銅金、`silver` 銀色（存在 `seal` 欄位；2026-10-13 使用者指定）。舊信件的 `kraft`／`airmail`／`sage` 樣式仍保留在 CSS，讓舊網址能正常顯示。

印章（`static/js/stamps.js`）：愛心、太陽、躺著的貓、笑臉書本、貢丸、兔子、笑臉肉包、棉花糖，可拖曳到信封任意位置，拖曳右上角 ↻ 旋轉（-180～180 度）、左下角圓點放大縮小（0.5–2.5 倍），存成 `stamps` JSON（相對座標、角度 `r`、大小倍率 `s`）。

預覽頁同時呈現信封與信紙。寄出後有「複製」網址與「預覽開信」（另開視窗預覽收信畫面）；LINE／其他 App 分享已依使用者要求移除。拆信載入畫面文字為「信件從遠方寄來了」。

配色集中在 `static/js/paper.js`（信紙、信封）與 `static/js/stamps.js`（印章）。

## 本機開發

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py            # http://127.0.0.1:5051
pytest                   # 後端測試
```

不設任何環境變數即可在本機跑（SQLite＋本機圖片資料夾）。

## 環境變數（只放在 Render，絕不 commit）

| 變數 | 用途 |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres 連線字串（Session pooler） |
| `SUPABASE_URL` | Supabase 專案網址 |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key（只在後端使用） |
| `SUPABASE_STORAGE_BUCKET` | Storage bucket 名稱，預設 `letters`（建議設為私有） |
| `LETTER_TTL_DAYS` | 信件保存天數，預設 `14` |

## 工作守則

- **金鑰、連線字串絕不 commit**；`.env`、`*.db`、`instance/` 已在 `.gitignore`。
- 介面以手機寬度為主（約 360–430px），桌機置中即可。
- 不引入前端建置工具，維持純 HTML／CSS／原生 JS，方便直接部署。
- 影像處理留在瀏覽器；後端只做驗證（必須是 PNG、大小上限）與儲存。
- 修改去背參數時，用晴子的實拍照片（白紙、陰影、光線不均）驗證，不要只用乾淨的掃描圖。
- 新功能先問是否屬於 MVP 範圍；多頁信、自訂信紙目前不做。
