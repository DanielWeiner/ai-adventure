FROM node:18-alpine AS base

WORKDIR /home/node/app

COPY ./ai-queue/package.json ai-queue/package.json
COPY ./ai-queue/package-lock.json ai-queue/package-lock.json
COPY ./package.json package.json
COPY ./package-lock.json package-lock.json

RUN npm install

FROM node:18-alpine AS install

WORKDIR /home/node/app

COPY ./ /home/node/app/
COPY --from=base /home/node/app/node_modules/ node_modules/
COPY --from=base /home/node/app/ai-queue/node_modules/ ai-queue/node_modules/

FROM install AS dev

ENTRYPOINT [ "/bin/sh", "app/docker/start_dev_server.sh" ]

FROM install AS main

RUN npm run build

ENTRYPOINT [ "npm", "run", "start" ]


