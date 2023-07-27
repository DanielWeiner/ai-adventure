#!/bin/sh
set -Eeuo pipefail
trap "kill 0" EXIT TERM INT ABRT

npm ci
npm run build
(
    set -euo pipefail
    cd .ai-queue
    npx nodemon --inspect=0.0.0.0:9229 server.js 
) &
(
    set -euo pipefail
    npm run watch
) &

wait -n
