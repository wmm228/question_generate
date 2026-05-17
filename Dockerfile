FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.ai-generators.json tsconfig.frontend.json ./
COPY src ./src
COPY ai_generators-ts ./ai_generators-ts
COPY static ./static
COPY tools ./tools

RUN npm run build


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV TUTOR_PORT=7896

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/static ./static
COPY src ./src
COPY oah-runtimes ./oah-runtimes
COPY resources ./resources

RUN mkdir -p /app/resources/runtime-state /app/logs /app/output \
  && chown -R node:node /app

USER node

EXPOSE 7896

CMD ["node", "dist/src/server.js"]
