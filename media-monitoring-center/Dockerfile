# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# Optional BuildKit secrets keep proxy settings and the existing CA out of image layers.
RUN --mount=type=secret,id=HTTP_PROXY,env=HTTP_PROXY \
    --mount=type=secret,id=HTTPS_PROXY,env=HTTPS_PROXY \
    --mount=type=secret,id=NO_PROXY,env=NO_PROXY \
    --mount=type=secret,id=npm_ca,target=/run/secrets/npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY src ./src
COPY scripts ./scripts
COPY config ./config
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    RECORDS_BACKEND=file \
    RECORDS_DIR=/var/data/records \
    UNIFIED_ADS_DATA_DIR=/var/data/unified
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
# Keep dev dependencies intentionally: operational TS scripts use tsx, and next.config.ts uses TS.
# A smaller image needs a separate compiled worker/config build; do not prune those tools here.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/next.config.ts /app/tsconfig.json ./
RUN mkdir -p /var/data/records /var/data/unified \
    && chown -R node:node /var/data \
    && chmod 0700 /var/data /var/data/records /var/data/unified
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Direct PID 1 receives termination signals; Next reads the hosting platform's PORT at runtime.
# Extraction/watch jobs are explicit separate processes, never an automatic startup side effect.
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
