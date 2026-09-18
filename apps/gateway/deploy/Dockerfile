FROM node:22.16.0-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
RUN node --test apps/gateway/test/*.node.mjs
FROM node:22.16.0-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4244 OATHRA_DB=/data/gateway.sqlite
EXPOSE 4244
CMD ["node","apps/gateway/server.mjs"]
