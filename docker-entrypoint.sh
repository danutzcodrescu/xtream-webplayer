#!/bin/sh
set -e

PUID=${PUID:-$(id -u appuser)}
PGID=${PGID:-$(id -g appuser)}

# Validate PUID/PGID are positive integers
case "$PUID" in
  ''|*[!0-9]*) echo "ERROR: PUID must be a positive integer, got: $PUID" >&2; exit 1 ;;
esac
case "$PGID" in
  ''|*[!0-9]*) echo "ERROR: PGID must be a positive integer, got: $PGID" >&2; exit 1 ;;
esac

# Remap appuser to the requested UID/GID
if [ "$(id -u appuser)" != "$PUID" ] || [ "$(id -g appgroup)" != "$PGID" ]; then
  if ! deluser appuser; then
    echo "WARNING: could not remove appuser, proceeding anyway" >&2
  fi
  if ! delgroup appgroup; then
    echo "WARNING: could not remove appgroup, proceeding anyway" >&2
  fi
  addgroup -g "$PGID" appgroup
  adduser -D -u "$PUID" -G appgroup appuser
fi

# Resolve symlinks before chown to avoid traversal outside /app/data
real_data=$(realpath /app/data)
case "$real_data" in
  /app/data*) chown -R appuser:appgroup "$real_data" ;;
  *) echo "ERROR: /app/data resolves outside expected path: $real_data" >&2; exit 1 ;;
esac

exec su-exec appuser "$@"
