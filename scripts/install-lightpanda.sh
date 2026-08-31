#!/bin/sh
set -eu

VERSION="${LIGHTPANDA_VERSION:-0.3.5}"
DEST="${LIGHTPANDA_DEST:-$PWD/.local/bin/lightpanda}"

case "$(uname -s):$(uname -m)" in
  Darwin:arm64) ASSET="lightpanda-aarch64-macos" ;;
  Darwin:x86_64) ASSET="lightpanda-x86_64-macos" ;;
  Linux:aarch64|Linux:arm64) ASSET="lightpanda-aarch64-linux" ;;
  Linux:x86_64|Linux:amd64) ASSET="lightpanda-x86_64-linux" ;;
  *)
    printf '%s\n' "Architecture non supportée : $(uname -s) $(uname -m)" >&2
    exit 1
    ;;
esac

URL="https://github.com/lightpanda-io/browser/releases/download/${VERSION}/${ASSET}"
mkdir -p "$(dirname "$DEST")"
printf 'Téléchargement de Lightpanda %s (%s)...\n' "$VERSION" "$ASSET"
TMP="${DEST}.tmp.$$"
trap 'rm -f "$TMP"' EXIT INT TERM
curl --fail --location --silent --show-error "$URL" --output "$TMP"
mv "$TMP" "$DEST"
chmod 755 "$DEST"
printf 'Lightpanda installé dans %s\n' "$DEST"
