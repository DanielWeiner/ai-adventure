FROM node:18-alpine

WORKDIR /home/node/app

COPY ./package.json /home/node/app/package.json
COPY ./package-lock.json /home/node/app/package-lock.json

RUN npm install

FROM node:18-alpine

WORKDIR /home/node/app
COPY ./ /home/node/app/
COPY --from=0 /home/node/app/node_modules/ /home/node/app/node_modules

EXPOSE 80

RUN npm run build:ai-queue

CMD [ "npm", "run", "start:ai-queue" ]