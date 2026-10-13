#!/bin/sh
set -eu
if [ -z "${AUDIVERIS_BIN:-}" ]; then
  for candidate in /opt/audiveris/bin/Audiveris /opt/audiveris/bin/audiveris /usr/bin/audiveris /usr/local/bin/audiveris; do
    if [ -x "$candidate" ]; then export AUDIVERIS_BIN="$candidate"; break; fi
  done
fi
exec node server.js
