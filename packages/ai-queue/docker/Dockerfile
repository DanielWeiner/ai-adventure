FROM node:18-alpine AS install
WORKDIR /home/node/app
COPY ./ /home/node/app/
RUN npx yarn workspace ai-queue install

FROM install AS dev
ENV NODE_ENV=development
ENTRYPOINT [ "/bin/sh", "packages/ai-queue/docker/start_dev_server.sh"]

FROM install as main
ENV NODE_ENV=production
RUN npm run --workspace=ai-queue build
ENTRYPOINT [ "npm", "run", "--workspace=ai-queue", "start" ]