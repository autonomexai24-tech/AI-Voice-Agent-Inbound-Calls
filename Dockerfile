ARG CACHE_BUST=1

FROM node:20-slim AS frontend-builder
ARG CACHE_BUST

WORKDIR /app/frontend

ENV NEXT_TELEMETRY_DISABLED=1

COPY frontend/package*.json ./
RUN echo "[docker] Frontend dependency cache bust: ${CACHE_BUST}" \
    && if [ -f package-lock.json ]; then npm ci --include=dev; else npm install --include=dev; fi

COPY frontend/ ./
RUN rm -rf .next tsconfig.tsbuildinfo \
    && NODE_ENV=production npm run build \
    && test -f .next/standalone/server.js

FROM python:3.11-slim AS python-builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.11-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV PATH=/root/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

COPY --from=frontend-builder /usr/local /usr/local
COPY --from=python-builder /root/.local /root/.local
COPY agent.py db.py init_db.py launch_validate.py notifications.py schema.sql start.sh tools.py ./
COPY --from=frontend-builder /app/frontend/.next/standalone ./frontend/.next/standalone
COPY --from=frontend-builder /app/frontend/.next/static ./frontend/.next/standalone/.next/static
COPY --from=frontend-builder /app/frontend/public ./frontend/.next/standalone/public
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
RUN chmod +x /app/start.sh

EXPOSE 3000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS 'http://127.0.0.1:3000/api/health?scope=liveness' || exit 1

CMD ["/app/start.sh"]
