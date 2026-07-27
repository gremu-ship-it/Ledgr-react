# Container image for the optional Ledgr API gateway (server/).
# Build context is the repository root; all COPY paths are relative to it.
# Deploys to Railway (railway.json) or Render (render.yaml).

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm ci
COPY server/tsconfig.json ./tsconfig.json
COPY server/src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
