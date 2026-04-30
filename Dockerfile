FROM node:20-alpine

WORKDIR /app

COPY package*.json package-lock.json ./
RUN npm ci --only=production

COPY server.js ./
COPY server/ ./server/
COPY client/ ./client/
COPY public/ ./public/
COPY data/ ./data/

EXPOSE 3000

CMD ["node", "server.js"]
