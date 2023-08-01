#!/bin/sh
set -Eeuo pipefail
trap "kill 0" EXIT TERM INT ABRT

(
    set -euo pipefail
    pnpm --filter ai-queue exec nodemon --inspect=0.0.0.0:9229 $(which npm) run start
) &
(
    set -euo pipefail
    pnpm --filter ai-queue watch
) &

wait -n
