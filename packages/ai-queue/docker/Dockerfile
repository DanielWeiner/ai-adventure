FROM node:18-alpine AS base
COPY ./ /home/node/app/
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache tini
RUN corepack enable
WORKDIR /home/node/app
ENTRYPOINT ["/sbin/tini", "--"]

FROM base AS prod-deps
RUN pnpm --filter ai-queue install --prod --frozen-lockfile

FROM base AS build
RUN pnpm --filter ai-queue install --frozen-lockfile
RUN pnpm --filter ai-queue build

FROM base AS dev
COPY --from=build /home/node/app/node_modules/ /home/node/app/node_modules
COPY --from=build /home/node/app/packages/ai-queue/node_modules/ /home/node/app/packages/ai-queue/node_modules
COPY --from=build /home/node/app/packages/ai-queue/.ai-queue /home/node/app/packages/ai-queue/.ai-queue

ENV NODE_ENV=development
CMD [ "/bin/sh", "packages/ai-queue/docker/start_dev_server.sh" ]

FROM base as main
COPY --from=prod-deps /home/node/app/node_modules/ /home/node/app/node_modules
COPY --from=prod-deps /home/node/app/packages/ai-queue/node_modules/ /home/node/app/packages/ai-queue/node_modules
COPY --from=build /home/node/app/packages/ai-queue/.ai-queue /home/node/app/packages/ai-queue/.ai-queue

WORKDIR /home/node/app/packages/ai-queue
ENV NODE_ENV=production
CMD [ "node", ".ai-queue/server.js" ]