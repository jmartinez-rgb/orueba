# syntax=docker/dockerfile:1

# ── Compilación ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional BuildKit secrets keep proxy settings and the existing CA out of image layers.
RUN --mount=type=secret,id=HTTP_PROXY,env=HTTP_PROXY \
    --mount=type=secret,id=HTTPS_PROXY,env=HTTPS_PROXY \
    --mount=type=secret,id=NO_PROXY,env=NO_PROXY \
    --mount=type=secret,id=npm_ca,target=/run/secrets/npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --offline

# ── Ejecución ────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /var/data/tokens \
    && chown node:node /var/data /var/data/tokens \
    && chmod 0700 /var/data/tokens
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
