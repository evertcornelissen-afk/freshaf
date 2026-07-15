# FreshAF — production image
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server ./server
COPY public ./public

# SQLite database lives here — mount a persistent disk/volume at /app/data
RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 5757
CMD ["node", "server/index.js"]
