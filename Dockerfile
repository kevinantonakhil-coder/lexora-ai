FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data/model-cache && chown -R node:node /app
USER node
ENV NODE_ENV=production
ENV LEXORA_HOST=0.0.0.0
ENV LEXORA_DATA_DIR=/app/data
ENV LEXORA_ML_CACHE_DIR=/app/data/model-cache
EXPOSE 3000
CMD ["node", "src/server.js"]
