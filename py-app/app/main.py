from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.db import init_db
from app.routes.assignments import router as assignments_router
from app.routes.employees import router as employees_router
from app.routes.schedule import router as schedule_router
from app.routes.shift_types import router as shift_types_router
from app.seed import ensure_default_shift_types
from app.tasks import echo

app = FastAPI(title="py-app", version="0.2.0")

# 讓你未來若不透過 Vite/Nginx proxy 直接打 API，也不會被 CORS 擋
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()
    # seed 預設班別
    from sqlmodel import Session

    from app.db import engine

    with Session(engine) as session:
        ensure_default_shift_types(session)


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


app.include_router(employees_router)
app.include_router(shift_types_router)
app.include_router(assignments_router)
app.include_router(schedule_router)


