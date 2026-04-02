FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/server/package.json packages/server/
RUN bun install --production --frozen-lockfile 2>/dev/null || bun install --production

COPY packages/server/src/ packages/server/src/
COPY packages/server/public/ packages/server/public/

EXPOSE 9999

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:9999/health || exit 1

USER bun
CMD ["bun", "packages/server/src/index.ts"]
