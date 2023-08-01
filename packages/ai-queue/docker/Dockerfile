FROM node:18-alpine AS base
COPY ./ /home/node/app/
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /home/node/app

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --filter ai-queue --prod --frozen-lockfile

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --filter ai-queue --frozen-lockfile
RUN pnpm --filter ai-queue build

FROM base AS dev
COPY --from=build /home/node/app/node_modules/ /home/node/app/node_modules
COPY --from=build /home/node/app/packages/ai-queue/node_modules/ /home/node/app/packages/ai-queue/node_modules
COPY --from=build /home/node/app/packages/ai-queue/.ai-queue /home/node/app/packages/ai-queue/.ai-queue

WORKDIR /home/node/app
ENV NODE_ENV=development
ENTRYPOINT [ "/bin/sh", "packages/ai-queue/docker/start_dev_server.sh" ]

FROM base as main
COPY --from=prod-deps /home/node/app/node_modules/ /home/node/app/node_modules
COPY --from=prod-deps /home/node/app/packages/ai-queue/node_modules/ /home/node/app/packages/ai-queue/node_modules
COPY --from=build /home/node/app/packages/ai-queue/.ai-queue /home/node/app/packages/ai-queue/.ai-queue

WORKDIR /home/node/app/
ENV NODE_ENV=production
ENTRYPOINT [ "pnpm", "--filter", "ai-queue", "exec", "npm", "run", "start" ]