FROM node:18-alpine AS install
WORKDIR /home/node/app
COPY ./ /home/node/app/
RUN npx yarn workspace ai-adventure-app -y install

FROM install AS dev
ENTRYPOINT [ "/bin/sh", "packages/app/docker/start_dev_server.sh" ]

FROM install AS main
RUN npx yarn workspace ai-adventure-app run build
ENTRYPOINT [ "npx", "yarn", "workspace", "ai-adventure-app", "run", "start" ]
