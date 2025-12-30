## 變更摘要

- 

## 驗證方式

- [ ] 本機 `docker compose up --build` 可正常啟動
- [ ] API：`GET /health` 正常
- [ ] 前端可正常呼叫 API（新增/修改/刪除員工、排班）
- [ ]（有背景任務相關變更才需要）Celery worker 可處理 `/tasks/echo`

## 影響範圍 / 風險

- 

## 變更摘要

- 

## 為什麼要改（背景/問題）

- 

## 怎麼驗證（必填）

- [ ] `docker compose up -d --build`（dev）
- [ ] `docker compose -f docker-compose.prod.yml up -d --build`（prod）
- [ ] 端點/畫面：
  - [ ] `http://localhost:3000/`
  - [ ] `http://localhost:8000/health`
  - [ ] `http://localhost:8000/docs`
  - [ ] `POST /tasks/echo` 後 worker log 有 `echo task received`

## 影響範圍 / 風險

- 

## 回滾方式

- 

## 截圖/錄影（如有 UI 變更）

- 


