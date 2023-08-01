FROM node:18-alpine AS install
WORKDIR /home/node/app
COPY ./ /home/node/app/
RUN corepack enable
RUN pnpm --filter ai-queue install

FROM install AS dev
ENV NODE_ENV=development
ENTRYPOINT [ "/bin/sh", "packages/ai-queue/docker/start_dev_server.sh" ]

FROM install as main
ENV NODE_ENV=production
RUN pnpm --filter ai-queue build
ENTRYPOINT [ "pnpm", "--filter", "ai-queue", "start" ]