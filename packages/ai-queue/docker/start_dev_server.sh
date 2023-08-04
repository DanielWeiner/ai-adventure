#!/bin/sh
set -Eeuo pipefail
trap "kill 0" EXIT TERM INT ABRT

(
    set -euo pipefail
    pnpm --filter ai-queue exec nodemon --watch .ai-queue --inspect=0.0.0.0:9229 .ai-queue/server.js
) &
(
    set -euo pipefail
    pnpm --filter ai-queue watch
) &

wait -n
