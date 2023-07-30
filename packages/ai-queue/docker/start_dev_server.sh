#!/bin/sh
set -Eeuo pipefail
trap "kill 0" EXIT TERM INT ABRT

npx yarn workspace ai-queue install
npm run --workspace=ai-queue build
(
    set -euo pipefail
    npx nodemon --inspect=0.0.0.0:9229 $(which npm) run --workspace=ai-queue start
) &
(
    set -euo pipefail
    npm run --workspace=ai-queue watch
) &

wait -n
