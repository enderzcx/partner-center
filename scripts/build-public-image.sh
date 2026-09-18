#!/usr/bin/env bash
set -euo pipefail
: "${BEEFAPI_SOURCE_DIR:?Set the reviewed BeefAPI worktree path}"
: "${PARTNER_IMAGE:?Set a versioned local image tag}"
project_root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$project_root/deploy/dist"
(cd "$BEEFAPI_SOURCE_DIR" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o "$project_root/deploy/dist/settlement-demo-source" ./cmd/settlement-demo-source)
docker build --platform linux/amd64 -f "$project_root/deploy/Dockerfile" -t "$PARTNER_IMAGE" "$project_root"
