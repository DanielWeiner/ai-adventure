FROM node:18-alpine AS base

WORKDIR /home/node/app

COPY ./package.json /home/node/app/package.json
COPY ./package-lock.json /home/node/app/package-lock.json

RUN npm install

FROM node:18-alpine AS install

WORKDIR /home/node/app

COPY ./ /home/node/app/
COPY --from=base /home/node/app/node_modules/ node_modules/

FROM base AS dev

ENV NODE_ENV=development

ENTRYPOINT [ "/bin/sh", "docker/start_dev_server.sh"]

FROM base as main

RUN npm run build

ENTRYPOINT [ "npm", "run", "start" ]