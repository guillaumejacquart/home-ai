#!/bin/sh
set -e

# Migrations at startup, then the server (exec so Node receives signals).
node src/db/migrate.ts
exec node server.js
