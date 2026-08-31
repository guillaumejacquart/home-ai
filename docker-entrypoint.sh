#!/bin/sh
set -e

# Migrations au démarrage, puis serveur (exec pour que Node reçoive les signaux).
node src/db/migrate.ts
exec node server.js
