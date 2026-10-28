import os
import re
from datetime import datetime, timezone
from sqlalchemy import create_engine, Column, BigInteger, Integer, String, Boolean, DateTime, Index
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session

Base = declarative_base()


class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    device_id = Column(String(64), nullable=False, index=True)
    object_detected = Column(Boolean, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("idx_sensor_readings_device_created", "device_id", "created_at", "id"),
    )

    def to_dict(self):
        created_str = None
        if self.created_at:
            # Ensure timezone is attached if naive
            dt = self.created_at
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
            created_str = dt.isoformat()

        return {
            "id": self.id,
            "device_id": self.device_id,
            "object_detected": bool(self.object_detected),
            "created_at": created_str,
        }


def normalize_database_url(url: str) -> str:
    """Ensure database URL has the correct SQLAlchemy driver scheme."""
    if not url:
        return "sqlite:///sensor_readings.db"
    
    # Handle Heroku / Supabase legacy prefix
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://") and "+psycopg" not in url and "+asyncpg" not in url:
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
        
    return url


def get_engine(database_url: str = None):
    url = normalize_database_url(database_url or os.getenv("DATABASE_URL", "sqlite:///sensor_readings.db"))
    
    engine_kwargs = {
        "future": True,
        "echo": False,
    }

    # Connection pooling configuration for PostgreSQL
    if url.startswith("postgresql"):
        engine_kwargs.update({
            "pool_size": 5,
            "max_overflow": 2,
            "pool_recycle": 300,
            "pool_pre_ping": True,
        })
    elif url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}

    return create_engine(url, **engine_kwargs)


def init_db(engine):
    """Create tables if they do not exist (especially useful for SQLite test runs)."""
    Base.metadata.create_all(bind=engine)
