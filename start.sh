#!/bin/sh
set -eu

python init_db.py
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
