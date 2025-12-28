## 專案骨架（前端 + Python API + Python Worker，Docker Compose）

這個 repo 提供團隊協作用的最小可跑範例：同時啟動 **前端（Vite+React，3000）**、**Python API（FastAPI，8000）**、**背景任務 worker（Celery）** 與 **Redis**，避免本機環境差異。

### 需求

- **Docker Desktop**（Windows/Mac）或 Docker Engine（Linux）
- 使用者可執行 `docker compose`

### 快速開始

- **啟動**

```bash
docker compose up --build
```

### Dev / Prod 的差異（建議）

- **Dev（預設 `docker-compose.yml`）**
  - 前端跑 Vite dev server（熱更新）
  - 掛載程式碼目錄，適合日常開發

- **Prod（`docker-compose.prod.yml`）**
  - 前端用 `node-app/Dockerfile` 先 build，再用 Nginx 提供靜態檔
  - Nginx 也會把 `/api/*` 反向代理到 `python-api:8000`
  - 適合部署/驗收環境

### 用 Prod compose 啟動

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 驗證

- **前端**：`http://localhost:3000/`
- **Python API**：
  - `http://localhost:8000/health`
  - Swagger UI：`http://localhost:8000/docs`

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


