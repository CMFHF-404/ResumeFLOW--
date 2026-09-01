FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    RESUMEFLOW_DEPLOYMENT_MODE=production

COPY requirements.txt ./

RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && python -m playwright install --with-deps chromium

COPY . .

RUN chmod +x prestart.sh \
    && touch /app/.resumeflow-production-image

# The immutable production-image marker forces production in prestart.sh even
# when a runtime environment attempts to override RESUMEFLOW_DEPLOYMENT_MODE.
# Docker production therefore requires
# FRONTEND_ORIGIN, CORS_ALLOW_ORIGINS, FRONTEND_LOGTO_ENDPOINT,
# FRONTEND_LOGTO_APP_ID, and FRONTEND_LOGTO_REDIRECT_URI.
# prestart.sh validates this public mirror before database initialization.
EXPOSE 8000

# /health only proves the process is alive. /ready also requires Logto JWKS
# readiness, so deployment traffic is not admitted during an auth cold start.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD python -c "from urllib.request import urlopen; import sys; sys.exit(0 if urlopen('http://127.0.0.1:8000/ready', timeout=3).status == 200 else 1)"

CMD ["sh", "./prestart.sh"]
