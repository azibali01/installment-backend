# ---------- STAGE 1: Build ----------
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Install build tools for native modules (bcrypt, etc.)
RUN apk add --no-cache python3 make g++ git

# Copy package files and install dependencies
COPY package*.json ./
COPY .npmrc ./
RUN npm install

# Copy the source code and build
COPY . .
RUN npm run build

# ---------- STAGE 2: Runtime ----------
FROM node:22-alpine AS runtime

# Set working directory
WORKDIR /app

# Set timezone to UTC
ENV TZ=UTC
ENV NODE_ENV=production

# Copy only production-ready files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Expose application port
EXPOSE 3000

# Start the app (adjust if your entry point is different)
CMD ["node", "dist/main.js"]
