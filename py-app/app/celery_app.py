import os

from celery import Celery

redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "py-app",
    broker=redis_url,
    backend=redis_url,
    include=["app.tasks"],
)


