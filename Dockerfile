# ---------- STAGE 1: Builder ----------
FROM node:22-alpine AS builder
WORKDIR /app

# Install build tools
RUN apk add --no-cache python3 make g++ git bash

# Copy package files and npmrc
COPY package*.json ./
COPY .npmrc ./

# Install all dependencies (dev + prod)
RUN npm ci

# Copy TypeScript config and source code
COPY tsconfig*.json ./
COPY src ./src

# Build the project with verbose logging
# This will print all TypeScript errors during Docker build
RUN npm run build || { echo "TypeScript build failed"; exit 1; }

# ---------- STAGE 2: Runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV TZ=UTC
ENV NODE_ENV=production
#test
# Copy production dependencies
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js

EXPOSE 3000
CMD ["node", "server.js"]
