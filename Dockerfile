# syntax=docker/dockerfile:1
FROM node:20-bullseye AS base

# Install ffmpeg for media processing
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy public assets
COPY public ./public

# Install server dependencies
COPY server/package*.json ./server/
RUN --mount=type=cache,target=/root/.npm cd server && npm ci --only=production

# Copy server source
COPY server ./server

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server/src/index.js"]

