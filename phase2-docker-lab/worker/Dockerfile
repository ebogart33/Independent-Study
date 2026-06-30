FROM node:20-alpine

WORKDIR /app

COPY package.json .

RUN npm install

COPY worker.js .

CMD ["npm", "start"]