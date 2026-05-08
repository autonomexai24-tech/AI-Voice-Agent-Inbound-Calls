#!/bin/sh
set -u

echo "[start.sh] Running database initialization..."
if python init_db.py; then
    echo "[start.sh] Database initialization completed."
else
    echo "[start.sh] ERROR: Database initialization failed. Refusing to start Supervisor."
    exit 1
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
