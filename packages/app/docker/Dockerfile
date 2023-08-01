FROM node:18-alpine AS install
WORKDIR /home/node/app
COPY ./ /home/node/app/
RUN corepack enable
RUN pnpm --filter ai-adventure-app install
FROM install AS dev
ENTRYPOINT [ "/bin/sh", "packages/app/docker/start_dev_server.sh" ]

FROM install AS main
RUN pnpm --filter ai-adventure-app build
ENTRYPOINT [ "pnpm", "--filter", "ai-adventure-app", "start" ]