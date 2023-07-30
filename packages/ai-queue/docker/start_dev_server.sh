#!/bin/sh
set -Eeuo pipefail
trap "kill 0" EXIT TERM INT ABRT

npx yarn workspace ai-queue install
npx lerna run --scope=ai-queue build
(
    set -euo pipefail
    npx nodemon --inspect=0.0.0.0:9229 packages/ai-queue/.ai-queue/server.js 
) &
(
    set -euo pipefail
    npx lerna run --scope=ai-queue watch
) &

wait -n
