# Stage 1: Build the TypeScript code
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Fetch Production Dependencies securely
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# --omit=dev ensures we don't install testing or typescript tools
RUN npm ci --omit=dev 

# Stage 3: The Production Image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# DEVSECOPS FIX: Patch underlying OS vulnerabilities AND upgrade global npm
RUN apk update && apk upgrade --no-cache && \
    npm install -g npm@10

# DevSecOps Best Practice: Never run as root. 
# We use the built-in 'node' user provided by the alpine image.
USER node

# Copy only what is strictly necessary from the previous stages
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./

EXPOSE 8000

# Run the compiled JavaScript directly
CMD ["node", "dist/server.js"]