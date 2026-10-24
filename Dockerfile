FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY index.html manifest.json sw.js build_www.js ./
COPY scripts ./scripts
COPY css ./css
COPY js ./js
COPY images ./images
COPY views ./views
COPY client-app/www ./client-app/www
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/www ./
COPY --from=build /app/views ./views
COPY --from=build /app/client-app/www ./client-app/www
COPY server ./server
COPY scripts/restore_bundle.js scripts/rotate_bank_key.js scripts/init_staging_database.js scripts/sync_staging_chart_of_accounts.js ./scripts/
RUN mkdir -p /data && chown node:node /data /app
# Railway mounts persistent volumes after the image build. The isolated staging
# bootstrap must therefore be able to create its first database on that mount.
# Production continues to use the protected main branch rather than this image.
USER root
# Node receives SIGTERM as PID 1. The guarded bootstrap runs only for the
# explicitly configured isolated staging database after Railway mounts /data.
CMD ["sh", "-c", "if [ \"$NODE_ENV\" = \"staging\" ] && [ \"$ALLOW_STAGING_DB_INIT\" = \"true\" ]; then node scripts/init_staging_database.js && node scripts/sync_staging_chart_of_accounts.js; fi; exec node server/server.js"]
