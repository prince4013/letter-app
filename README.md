# 手寫信（暫名 letter-app）

把手寫的字變成一封可以「拆」的電子信。寫好的信會產生一個不可猜的網址，對方點開會先看到信封，按下封蠟才拆信。

完整規格與開發守則請看 [CLAUDE.md](CLAUDE.md)。

## 本機執行

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py           # 打開 http://127.0.0.1:5051
pip install pytest && pytest
```

不設定環境變數時，資料存在本機 `instance/`（SQLite＋圖片資料夾）。

## 部署（GitHub → Render，沿用橘語的方式）

### 1. 建立 Supabase 新專案（與橘語分開）

1. 到 [supabase.com](https://supabase.com) 建立新專案。
2. **Storage** → **New bucket**，名稱 `letters`，**不要**勾 Public（圖片一律經由後端轉送）。
3. **Project Settings → API** 記下 Project URL 與 `service_role` key。
4. **Project Settings → Database → Connection string**，複製 **Session pooler** 的 URI（把 `[YOUR-PASSWORD]` 換成資料庫密碼）。

資料表會在 App 第一次啟動時自動建立，不用手動建。

### 2. Render

1. **New + → Web Service**，選這個 repo。
2. Runtime：Python 3；Build Command：`pip install -r requirements.txt`；Start Command：`python -m gunicorn app:app`；Instance Type：Free。
3. Environment Variables（**只放這裡，絕不 commit**）：

| Key | Value |
| --- | --- |
| `DATABASE_URL` | Supabase Session pooler 連線字串 |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_KEY` | `service_role` key |
| `SUPABASE_STORAGE_BUCKET` | `letters`（可省略） |
| `LETTER_TTL_DAYS` | `30`（可省略） |

部署完成後打開 Render 給的網址就是寄信頁。

## 注意

- Render 免費方案閒置後會休眠，第一次打開要等幾十秒才會出現畫面；之後拆信頁會先顯示「信件準備中」直到信件載入完成。
- 信件預設保存 30 天，拆信頁會提醒對方「收下存檔」。
