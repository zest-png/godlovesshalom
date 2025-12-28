import { useMemo, useState } from "react";

type Health = { ok: boolean; service: string };

type EnqueueResponse = {
  task_id: string;
};

export default function App() {
  const [apiHealth, setApiHealth] = useState<Health | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBase = useMemo(() => "/api", []);

  async function checkHealth() {
    setError(null);
    setTaskId(null);
    const res = await fetch(`${apiBase}/health`);
    if (!res.ok) throw new Error(`API /health 失敗：${res.status}`);
    setApiHealth((await res.json()) as Health);
  }

  async function enqueueTask() {
    setError(null);
    const res = await fetch(`${apiBase}/tasks/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello from web" }),
    });
    if (!res.ok) throw new Error(`API enqueue 失敗：${res.status}`);
    const data = (await res.json()) as EnqueueResponse;
    setTaskId(data.task_id);
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>web（Vite + React + TS）</h1>
      <p>此頁面會透過 Vite proxy 把 <code>/api</code> 轉送到 Python API。</p>

      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button
          onClick={() => checkHealth().catch((e) => setError(String(e)))}
          type="button"
        >
          檢查 API /health
        </button>
        <button
          onClick={() => enqueueTask().catch((e) => setError(String(e)))}
          type="button"
        >
          送出背景任務（Celery）
        </button>
      </div>

      {error ? (
        <pre style={{ background: "#fee", padding: 12, marginTop: 16, whiteSpace: "pre-wrap" }}>
          {error}
        </pre>
      ) : null}

      {apiHealth ? (
        <pre style={{ background: "#f6f8fa", padding: 12, marginTop: 16 }}>
          API health: {JSON.stringify(apiHealth, null, 2)}
        </pre>
      ) : null}

      {taskId ? (
        <pre style={{ background: "#f6f8fa", padding: 12, marginTop: 16 }}>
          已送出 task_id: {taskId}
        </pre>
      ) : null}
    </div>
  );
}


