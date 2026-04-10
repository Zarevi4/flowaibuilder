# Stage 1: Build shared + server
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package files for workspace setup
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
# Create stub for UI workspace so npm ci doesn't fail
RUN mkdir -p packages/ui && echo '{"name":"@flowaibuilder/ui","version":"0.1.0","private":true}' > packages/ui/package.json

RUN npm ci

# Build shared first (server depends on it)
COPY packages/shared/ ./packages/shared/
RUN npm run build -w packages/shared

# Build server
COPY packages/server/ ./packages/server/
RUN npm run build -w packages/server

# Stage 2: Production
FROM node:22-alpine

WORKDIR /app

# Copy package files for workspace structure
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/server/package.json ./packages/server/

# Copy node_modules (drizzle-kit, tsx needed for migrations)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules

# Copy built shared package
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Copy built server
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# Copy drizzle config and schema (needed for migrations)
COPY --from=builder /app/packages/server/drizzle.config.ts ./packages/server/
COPY --from=builder /app/packages/server/src/db/ ./packages/server/src/db/

# Copy entrypoint
COPY packages/server/docker-entrypoint.sh ./packages/server/
RUN chmod +x ./packages/server/docker-entrypoint.sh

EXPOSE 3000 5174

WORKDIR /app/packages/server

ENTRYPOINT ["./docker-entrypoint.sh"]
