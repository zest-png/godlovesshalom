FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir -U pip && \
    python -m pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

# 避免 Celery 以 root 身分執行（更貼近團隊部署/CI 的最佳實務）
RUN useradd -m -u 10001 appuser
USER appuser


