"""
REHABOPT — config.py
Centralized configuration with environment variable support.
"""
import os
import secrets


class Config:
    """Base configuration."""
    # Flask
    SECRET_KEY = os.environ.get("SECRET_KEY", secrets.token_hex(32))
    JSON_SORT_KEYS = False
    
    # Database
    DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data", "rehab.db"
    ))
    
    # Gemini AI
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
    
    # Server
    HOST = os.environ.get("HOST", "0.0.0.0")
    PORT = int(os.environ.get("PORT", 8000))
    WORKERS = int(os.environ.get("WORKERS", 4))
    
    # Security
    SESSION_COOKIE_NAME = os.environ.get("SESSION_COOKIE_NAME", "rehabopt_session")
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_PATH = os.environ.get("SESSION_COOKIE_PATH", "/")
    PERMANENT_SESSION_LIFETIME = 86400  # 24 hours
    
    # Upload limits
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB
    UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "uploads")


class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    FLASK_ENV = "development"
    SESSION_COOKIE_SECURE = False


class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False
    FLASK_ENV = "production"


class TestingConfig(Config):
    """Testing configuration."""
    TESTING = True
    DATABASE_PATH = ":memory:"


def get_config():
    """Get configuration based on environment."""
    env = os.environ.get("FLASK_ENV", "production").lower()
    configs = {
        "development": DevelopmentConfig,
        "production": ProductionConfig,
        "testing": TestingConfig,
    }
    return configs.get(env, ProductionConfig)
