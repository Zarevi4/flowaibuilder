# Stage 1: Build shared + UI
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package files for workspace setup
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
# Create stub for server workspace so npm ci doesn't fail
RUN mkdir -p packages/server && echo '{"name":"@flowaibuilder/server","version":"0.1.0","private":true}' > packages/server/package.json

RUN npm ci

# Build shared first (UI depends on it)
COPY packages/shared/ ./packages/shared/
RUN npm run build -w packages/shared

# Build UI
COPY packages/ui/ ./packages/ui/
RUN npm run build -w packages/ui

# Stage 2: Serve with nginx
FROM nginx:alpine-slim

# Copy built UI files
COPY --from=builder /app/packages/ui/dist /usr/share/nginx/html

# Copy nginx config
COPY packages/ui/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
