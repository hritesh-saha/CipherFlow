# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev 

# Stage 3: The Production Image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# DEVSECOPS FIX: Delete npm entirely. 
# We only need the 'node' binary to run our compiled app.
# By deleting npm, we eliminate the entire attack surface and Trivy CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm \
    && rm -f /usr/local/bin/npx

USER node

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./

# The worker initiates connections; it does not receive them.
CMD ["node", "dist/worker.js"]