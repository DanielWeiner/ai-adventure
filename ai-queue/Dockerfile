FROM node:18-alpine

WORKDIR /home/node/app

COPY ./ /home/node/app/

RUN npm install
RUN npm run build:ai-queue

EXPOSE 80

CMD [ "npm", "run", "start:ai-queue" ]