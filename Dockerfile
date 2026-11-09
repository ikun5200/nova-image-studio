FROM node:22-slim AS frontend-builder

WORKDIR /app

# 构建机上统一走官方 npm registry；lockfile 里个别 npmmirror 地址会被替换掉。
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=always

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY frontend/ ./frontend/

RUN cd frontend && npm ci && npm run build

FROM node:22-slim AS backend-deps

WORKDIR /app/backend

ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org \
    NPM_CONFIG_REPLACE_REGISTRY_HOST=always

# better-sqlite3 需要在安装阶段使用 python3、make、g++
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./

RUN npm ci --omit=dev \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

FROM node:22-slim AS production

WORKDIR /app

ENV NODE_ENV=production

COPY backend/ ./backend/
COPY --from=backend-deps /app/backend/node_modules/ ./backend/node_modules/
COPY --from=frontend-builder /app/frontend/out/ ./frontend/out/

RUN mkdir -p /app/backend/data

EXPOSE 3000

CMD ["node", "backend/server.js"]
