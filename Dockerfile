# ---------- STAGE 1: Build ----------
FROM node:22-alpine AS builder
WORKDIR /app

# Install build tools for native modules
RUN apk add --no-cache python3 make g++ git bash

# Copy package files and npmrc
COPY package*.json ./
COPY .npmrc ./

# Install all dependencies (dev + prod) for build
RUN npm ci

# Copy all source code
COPY . .

# Build the project (if you have a build step)
RUN npm run build

# ---------- STAGE 2: Runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV TZ=UTC
ENV NODE_ENV=production

# Copy package files
COPY --from=builder /app/package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy the built/dist folder if exists, otherwise copy source
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js

EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
