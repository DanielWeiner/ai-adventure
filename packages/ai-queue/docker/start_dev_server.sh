#!/bin/sh
set -Eeuo pipefail
trap "kill 0" EXIT TERM INT ABRT

npx yarn workspace ai-queue install
npx yarn workspace ai-queue run build
(
    set -euo pipefail
    npx nodemon --inspect=0.0.0.0:9229 packages/ai-queue/.ai-queue/server.js 
) &
(
    set -euo pipefail
    npx yarn workspace ai-queue run watch
) &

wait -n
