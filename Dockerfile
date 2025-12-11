FROM node:24-alpine AS builder

    WORKDIR /app
    
    COPY package*.json ./
    RUN npm install
    
    COPY . .
    RUN npm run build
    
    
    FROM node:24-alpine
    
    WORKDIR /app
    
    COPY --from=builder /app/package*.json ./
    COPY --from=builder /app/dist ./dist
    
    RUN npm install --omit=dev
    
  
    EXPOSE 3000
    
    CMD ["node", "dist/server.js"]