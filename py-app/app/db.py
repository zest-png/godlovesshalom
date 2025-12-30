import os
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine


def _default_sqlite_url() -> str:
    # 預設把 DB 放在 /app/data/app.db（搭配 docker volume 最好保存）
    data_dir = Path(os.environ.get("APP_DATA_DIR", "/app/data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{(data_dir / 'app.db').as_posix()}"


DATABASE_URL = os.environ.get("DATABASE_URL", _default_sqlite_url())

connect_args = {}
if DATABASE_URL.startswith("sqlite:"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _sqlite_light_migrate()


def _sqlite_light_migrate() -> None:
    # MVP：為了避免既有 app.db 因為新增欄位而爆掉，針對 SQLite 做最小化欄位補齊
    if not DATABASE_URL.startswith("sqlite:"):
        return

    with engine.connect() as conn:
        try:
            rows = conn.exec_driver_sql("PRAGMA table_info(employee)").fetchall()
        except Exception:
            return
        existing_cols = {r[1] for r in rows}  # (cid, name, type, notnull, dflt_value, pk)

        def add_col(sql: str, col_name: str) -> None:
            if col_name in existing_cols:
                return
            conn.exec_driver_sql(sql)

        add_col("ALTER TABLE employee ADD COLUMN max_work_days_per_month INTEGER NOT NULL DEFAULT 0", "max_work_days_per_month")
        add_col("ALTER TABLE employee ADD COLUMN max_consecutive_work_days INTEGER NOT NULL DEFAULT 6", "max_consecutive_work_days")
        add_col("ALTER TABLE employee ADD COLUMN can_work_night INTEGER NOT NULL DEFAULT 1", "can_work_night")
        add_col("ALTER TABLE employee ADD COLUMN night_only INTEGER NOT NULL DEFAULT 0", "night_only")
        add_col("ALTER TABLE employee ADD COLUMN special_requirements TEXT", "special_requirements")

        conn.commit()


def get_session():
    with Session(engine) as session:
        yield session


