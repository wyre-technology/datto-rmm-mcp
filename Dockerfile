FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and .npmrc for GitHub Package Registry
COPY package*.json .npmrc ./

# Build argument for GitHub token (passed at build time)
ARG GITHUB_TOKEN
ENV NODE_AUTH_TOKEN=$GITHUB_TOKEN

RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mcp

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER mcp

# MCP servers communicate via stdio
CMD ["node", "dist/index.js"]
