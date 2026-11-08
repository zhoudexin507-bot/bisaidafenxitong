FROM node:24-bookworm-slim AS build
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app
COPY package*.json ./
RUN npm config set registry "${NPM_REGISTRY}" && npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY scripts/build.mjs ./scripts/build.mjs
COPY src ./src
COPY shared ./shared
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DB_PATH=/app/data/competition.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm config set registry "${NPM_REGISTRY}" && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force && mkdir -p data backups && chown -R node:node data backups
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
