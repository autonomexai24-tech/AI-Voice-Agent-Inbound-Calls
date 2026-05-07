#!/bin/sh
set -u

echo "[start.sh] Running database initialization..."
if python init_db.py; then
    echo "[start.sh] Database initialization completed."
else
    echo "[start.sh] WARNING: Database initialization failed. Starting Supervisor anyway so logs remain visible."
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
