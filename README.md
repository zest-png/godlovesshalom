## 飯店櫃台排班系統（前端 + Python API + Python Worker，Docker Compose）

這個 repo 提供一個可直接使用/擴充的排班 MVP：同時啟動 **前端（Vite+React，3000）**、**Python API（FastAPI，8000）**、**背景任務 worker（Celery）** 與 **Redis**，並使用 **SQLite** 保存排班資料，避免本機環境差異。

### 需求

- **Docker Desktop**（Windows/Mac）或 Docker Engine（Linux）
- 使用者可執行 `docker compose`

### 快速開始

- **啟動**

```bash
docker compose up --build
```

### 排班功能（MVP）

- 前端：`http://localhost:3000/`
  - 新增員工
    - 可輸入：員工姓名、可上班天數（當月上限）、是否可排夜班、是否只排夜班、特殊需求（文字）
  - 選擇月份
  - 在表格單格下拉選班別（即時保存）
  - 「自動排班（依規則）」：依需求人數（預設 早2/晚2/夜1）產生整月排班，並遵守以下限制：
    - 每人可上班天數上限（當月）
    - 不可排夜班（若員工設定不可）
    - 最多連續上班天數
    - 每 7 日至少休 N 日（預設 2）
    - 夜班（N）隔天不排早班（M）
    - 若不覆蓋且某天某班人力超過需求，可選擇自動把多的人改排休假（O）
    - 可選擇「上班盡量集中」，避免排成上一天休一天（在不違反連上/週休等限制前提下）
    - 可選擇「休假與休假之間盡量同班別」，讓同一段連續上班盡量不換班
  - 匯出 Excel（.xlsx）
  - 「補滿休假（O）」：把該月所有空白格自動補成休假（不會覆蓋你已排的班）
  - 可一鍵載入 **2026 台灣國定假日** 到「額外假日日期」欄位（仍可手動增修）

- API（Swagger）：`http://localhost:8000/docs`
  - 員工：`GET/POST /employees`
  - 班別：`GET /shift-types`
  - 排班：`GET /assignments?month=YYYY-MM`、`PUT /assignments`
  - 自動排班：`POST /schedule/generate?month=YYYY-MM`

### Dev / Prod 的差異（建議）

- **Dev（預設 `docker-compose.yml`）**
  - 前端跑 Vite dev server（熱更新）
  - 掛載程式碼目錄，適合日常開發

- **Prod（`docker-compose.prod.yml`）**
  - 前端用 `node-app/Dockerfile` 先 build，再用 Nginx 提供靜態檔
  - Nginx 也會把 `/api/*` 反向代理到 `python-api:8000`
  - 適合部署/驗收環境
  - SQLite DB 會掛載到 `./py-app/data`（容器 `/app/data`）以保存資料

### 用 Prod compose 啟動

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 雲端部署（VPS/主機，推薦：最接近「自己網域一套搞定」）

這個方式適合你要讓同事用「網址」遠端使用，並且希望資料（SQLite）可以留在主機上。

#### 你需要準備

- 一台 Linux VPS（Ubuntu 22.04/24.04 都可）
- 一個網域（可選，但建議；有網域才有自動 HTTPS）

#### Step 1：VPS 安裝 Docker

在 VPS 上：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

#### Step 2：拉下專案並設定網域

```bash
git clone <你的 repo url> phone
cd phone
```

如果你有網域（例如 `schedule.example.com`），先把 **DNS A record** 指到 VPS 公網 IP，然後在 VPS 設：

```bash
export APP_DOMAIN=schedule.example.com
```

如果你暫時沒有網域，只想先用 IP 測試（只有 HTTP），可用：

```bash
export APP_DOMAIN=":80"
```

#### Step 3：啟動雲端 compose（含自動 HTTPS）

```bash
docker compose -f docker-compose.cloud.yml up -d --build
```

#### 使用網址

- 網域模式：直接開 `https://<你的網域>/`
- IP 測試：開 `http://<你的 VPS IP>/`

> 注意：這份 `docker-compose.cloud.yml` 會用 Caddy 自動管理憑證與反向代理，`/api/*` 會轉給 FastAPI，其餘路由給前端。

### Render（最適合沒工程背景的雲端部署）

這個專案在 Render 建議用「**前端 Static Site** + **後端 Web Service（FastAPI）** + **Background Worker（Celery）** + **Redis**」，並替後端加一顆 **Persistent Disk** 來保存 SQLite（`app.db`）。

#### 最快方式：用 Blueprint（render.yaml）

本 repo 已提供 `render.yaml`，你可以在 Render 直接用它一鍵建立服務。

1. 把 repo push 到 GitHub（私有/公開都可）
2. Render Dashboard → **New → Blueprint**
3. 選你的 repo，Render 會依 `render.yaml` 建立：
   - `phone-redis`（Redis）
   - `phone-api`（FastAPI + Persistent Disk）
   - `phone-worker`（Celery worker）
   - `phone-web`（Static Site）
4. 建好後，到 `phone-web` 的 Environment 設定：
   - 設定 `VITE_API_BASE_URL` = `phone-api` 的公開網址（例如 `https://phone-api.onrender.com`）
   - 重新 Deploy `phone-web`

完成後大家就能用 `phone-web` 的公開網址遠端使用。

#### 事前準備

- 把這個 repo push 到 GitHub（或 GitLab/Bitbucket）。
- 你只需要會「登入 Render → 按 New 建立服務 → 填幾個欄位」。不需要 SSH、不需要自己管主機。

#### Step 1：建立 Redis（給 Celery 用）

在 Render Dashboard：**New → Redis**

- Name：隨意（例如 `phone-redis`）
- Plan：可先用 Free（看你需求）

建立後先記下它提供的 **Internal Redis URL**（稍後要貼到 `REDIS_URL`）。

#### Step 2：建立後端 API（FastAPI）

在 Render Dashboard：**New → Web Service**

- **Repository**：選你的 repo
- **Root Directory**：`py-app`
- **Runtime**：Python
- **Build Command**：`pip install -r requirements.txt`
- **Start Command**：`uvicorn app.main:app --host 0.0.0.0 --port $PORT`

環境變數（Environment）：

- **REDIS_URL**：貼上你剛剛 Redis 的 **Internal Redis URL**
- **APP_DATA_DIR**：`/var/data`（把 SQLite 放在持久磁碟）

加上持久磁碟（Disks）：

- **Add Disk**
  - Mount Path：`/var/data`
  - Size：1GB 起跳即可（依資料量調整）

部署完成後，你會拿到 API 的公開網址（例如 `https://xxx.onrender.com`），打開：

- `GET /health`：確認 API 活著
- `GET /docs`：Swagger

#### Step 3：建立背景任務 Worker（Celery）

在 Render Dashboard：**New → Background Worker**

- **Repository**：同一個 repo
- **Root Directory**：`py-app`
- **Runtime**：Python
- **Build Command**：`pip install -r requirements.txt`
- **Start Command**：`celery -A app.celery_app:celery_app worker --loglevel=INFO`

環境變數（Environment）：

- **REDIS_URL**：同 Step 2（貼 Redis 的 **Internal Redis URL**）

#### Step 4：建立前端（React 靜態站）

在 Render Dashboard：**New → Static Site**

- **Repository**：同一個 repo
- **Root Directory**：`node-app`
- **Build Command**：`npm ci && npm run build`
- **Publish Directory**：`dist`

環境變數（Environment）（很重要，這是「前端要打哪個 API」）：

- **VITE_API_BASE_URL**：貼上你 Step 2 的 API 公開網址（例如 `https://xxx.onrender.com`）

SPA 站點重整不 404（很重要）：

- 到這個 Static Site 的設定裡，新增一條 **Rewrite**
  - Source：`/*`
  - Destination：`/index.html`
  - Action：Rewrite（或 200）

完成後打開 Static Site 的網址，就會看到前端 UI，並能正常呼叫 API。

####（可選）自動部署：用 Cursor 改完程式 → push → Render 自動上線

你用 Cursor 寫完程式後，只要 **commit + push 到 GitHub**，就能自動把最新版本部署到 Render，其他人用同一個網址就能看到更新。

有兩種做法（擇一即可）：

- **A. 用 Render 內建 Auto Deploy（最簡單，推薦新手）**
  - 在 Render 每個服務的設定中，確認 **Auto Deploy** 是開啟狀態。
  - 之後只要你 push 到指定 branch（例如 `main`），Render 會自動 build + deploy。

- **B. 用 GitHub Actions：CI 綠燈才部署（更安全，已幫你做好）**
  - repo 內已新增：`.github/workflows/deploy-render.yml`
  - 行為：`main` 有 push → 跑 `.github/workflows/ci.yml` → **CI 成功** 才會觸發 Render 部署
  - 注意：若你同時開啟 **Render Auto Deploy** 與 **Deploy Hook**，可能會「同一次 push 觸發兩次部署」；建議二選一（或把 Auto Deploy 關掉）。

  你只需要在 GitHub 設定三個 Secrets（Deploy Hook URL）：

  - 到 GitHub Repo：**Settings → Secrets and variables → Actions → New repository secret**
  - 新增：
    - `RENDER_DEPLOY_HOOK_API`：Render 後端 API（Web Service）的 Deploy Hook URL
    - `RENDER_DEPLOY_HOOK_WORKER`：Render Worker（Background Worker）的 Deploy Hook URL
    - `RENDER_DEPLOY_HOOK_WEB`：Render 前端（Static Site）的 Deploy Hook URL

  Deploy Hook 在 Render 的位置通常在每個服務的 **Settings / Deploy Hooks**（或類似名稱）頁面；複製 URL 後貼到 GitHub Secrets 即可。

### 驗證

- **前端**：`http://localhost:3000/`
- **Python API**：
  - `http://localhost:8000/health`
  - Swagger UI：`http://localhost:8000/docs`

### 資料保存（SQLite）

- 預設 DB 檔案：`./py-app/data/app.db`
- 若要改用其他資料庫，可設定環境變數 `DATABASE_URL`

#### 兩台電腦同步資料（方案 A 延伸）

如果你想讓「另一台電腦」也看到同一份員工/班表資料，最簡單方式是把 SQLite 放到雲端同步資料夾（例如 OneDrive/Dropbox），並用 `APP_DATA_DIR` 指到該資料夾：

> 注意：SQLite 不適合「兩台同時開著」寫入；建議一次只開一台。若要多人同時用，建議改用 Postgres/MySQL。

**Windows（PowerShell）範例：**

```powershell
$env:APP_DATA_DIR="C:/Users/<你>/OneDrive/phone-data"
docker compose up -d --build
```

兩台電腦都設定成同一個雲端同步資料夾後，就會共用同一個 `app.db`。

### 勞基法注意事項（重要）

- 本專案提供的是「常見排班底線」的工程化約束（例如每 7 日至少休 2 日等），**不構成法律意見**。
- 你們實際的班表規則（例假/休息日調移、變形工時、加班與工時計算、輪班間隔等）可能因公司制度與適用條件不同而有差異，建議由 HR/法務確認後再把規則落地成更精準的限制。

### 背景任務（worker）測試

- **方式 A：用前端按鈕**
  - 打開 `http://localhost:3000/`
  - 點「送出背景任務（Celery）」後會拿到 `task_id`
  - 觀察 worker log 是否有印出 `echo task received`

- **方式 B：用命令列**

```bash
curl -X POST http://localhost:8000/tasks/echo -H "content-type: application/json" -d "{\"message\":\"hello\"}"
docker compose logs -f --tail=100 python-worker
```

### 目錄結構

- `node-app/`：前端（Vite + React + TS）
- `py-app/`：Python（FastAPI + Celery）

### 常用指令

- **背景啟動**

```bash
docker compose up -d
```

- **停止並移除**

```bash
docker compose down
```

### 版本鎖定（團隊協作建議）

- **前端（Node）**
  - 已提交 `node-app/package-lock.json`
  - 容器內使用 `npm ci`，確保依賴一致
  - **更新依賴**：在 `node-app/package.json` 修改後，重新產生 lock：

```bash
docker run --rm -v ${PWD}:/repo -w /repo/node-app node:24-alpine sh -lc "npm install --package-lock-only"
```

- **Python**
  - 使用 `py-app/requirements.in` 維護「頂層依賴」
  - `py-app/requirements.txt` 由 `pip-compile` 產生（釘死含 transitive 版本）
  - **更新依賴**：修改 `requirements.in` 後重新 compile：

```bash
docker run --rm -v ${PWD}:/repo -w /repo/py-app python:3.13-slim bash -lc "python -m pip install -U pip pip-tools && pip-compile requirements.in -o requirements.txt"
```

### CI（GitHub Actions）

- 位置：`.github/workflows/ci.yml`
- 內容：
  - **Dev stack**：起 `docker compose`，檢查 API `/health`，並 enqueue 一個 Celery 任務確認 worker 有處理。
  - **Prod stack**：起 `docker compose -f docker-compose.prod.yml`，檢查 Nginx 前端可回應、`/api/*` 代理正常，並 enqueue 任務確認 worker 有處理。

### 團隊協作流程（建議）

- **PR 模板**：`.github/PULL_REQUEST_TEMPLATE.md`（請填寫變更摘要與驗證方式）
- **CODEOWNERS**：`.github/CODEOWNERS`（可指定路徑的預設審核者；請把 `@YOUR_OWNER` 改成你們實際的 owner/team）


