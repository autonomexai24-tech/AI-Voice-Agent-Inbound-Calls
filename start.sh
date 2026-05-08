#!/bin/sh
set -u

echo "[start.sh] Frontend standalone path: /app/frontend/.next/standalone"
if [ -f /app/frontend/.next/standalone/server.js ]; then
    echo "[start.sh] Frontend standalone server found."
else
    echo "[start.sh] ERROR: Missing /app/frontend/.next/standalone/server.js"
    exit 1
fi

echo "[start.sh] Node version: $(node --version)"
echo "[start.sh] Running database initialization..."
if python init_db.py; then
    echo "[start.sh] Schema initialized and database connection verified."
else
    echo "[start.sh] ERROR: Database initialization failed. Refusing to start Supervisor."
    exit 1
fi

echo "[start.sh] Starting Supervisor..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
