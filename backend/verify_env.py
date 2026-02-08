from app.config import load_settings

try:
    settings = load_settings()
    print(f"DATABASE_URL is: {settings.database_url}")
except Exception as e:
    print(f"Error loading settings: {e}")
