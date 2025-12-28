from celery.utils.log import get_task_logger

from app.celery_app import celery_app

logger = get_task_logger(__name__)


@celery_app.task(name="tasks.echo")
def echo(message: str) -> dict:
    logger.info("echo task received: %s", message)
    return {"echo": message}


