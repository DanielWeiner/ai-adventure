FROM node:18-alpine AS install
WORKDIR /home/node/app
COPY ./ /home/node/app/
RUN npx yarn workspace ai-adventure-app install

FROM install AS dev
ENTRYPOINT [ "/bin/sh", "packages/app/docker/start_dev_server.sh" ]

FROM install AS main
RUN npm run --workspace=ai-adventure-app build
ENTRYPOINT [ "npm", "run", "--workspace=ai-adventure-app", "start" ]
