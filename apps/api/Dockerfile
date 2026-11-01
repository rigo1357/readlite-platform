FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/migrations.config.mjs ./apps/api/migrations.config.mjs
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --no-audit --no-fund

COPY apps/api ./apps/api

RUN npm run build --workspace @readlite/api

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/migrations.config.mjs ./apps/api/migrations.config.mjs
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --omit=dev --no-audit --no-fund --workspace @readlite/api
RUN mkdir -p /var/lib/readlite/media && chown -R node:node /var/lib/readlite

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY db/migrations ./db/migrations

USER node

CMD ["node", "apps/api/dist/server.js"]
