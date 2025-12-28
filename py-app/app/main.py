from fastapi import FastAPI
from pydantic import BaseModel

from app.tasks import echo

app = FastAPI(title="py-app", version="0.1.0")


@app.get("/health")
def health():
    return {"ok": True, "service": "python"}


@app.get("/")
def root():
    return {"message": "py-app: hello"}


class EchoRequest(BaseModel):
    message: str


@app.post("/tasks/echo")
def enqueue_echo(req: EchoRequest):
    result = echo.delay(req.message)
    return {"task_id": result.id}


