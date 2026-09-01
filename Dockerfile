FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

ARG VITE_API_BASE_URL
ARG VITE_FRONTEND_ORIGIN
ARG VITE_LOGTO_ENDPOINT
ARG VITE_LOGTO_APP_ID
ARG VITE_LOGTO_REDIRECT_URI
ARG VITE_LOGTO_ACCOUNT_CENTER_URL
ARG YIFUT_BASE_URL=https://www.yifut.com

# These public build args are embedded into the Vite bundle. They must be
# supplied to `docker build`; changing a running container cannot reconfigure
# the already-built browser application.
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_FRONTEND_ORIGIN=$VITE_FRONTEND_ORIGIN \
    VITE_LOGTO_ENDPOINT=$VITE_LOGTO_ENDPOINT \
    VITE_LOGTO_APP_ID=$VITE_LOGTO_APP_ID \
    VITE_LOGTO_REDIRECT_URI=$VITE_LOGTO_REDIRECT_URI \
    VITE_LOGTO_ACCOUNT_CENTER_URL=$VITE_LOGTO_ACCOUNT_CENTER_URL \
    YIFUT_BASE_URL=$YIFUT_BASE_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN test -n "$VITE_API_BASE_URL" \
    && test -n "$VITE_FRONTEND_ORIGIN" \
    && test -n "$VITE_LOGTO_ENDPOINT" \
    && test -n "$VITE_LOGTO_APP_ID" \
    && test -n "$VITE_LOGTO_REDIRECT_URI" \
    && test -n "$VITE_LOGTO_ACCOUNT_CENTER_URL" \
    && node tools/validate-production-origins.mjs --write-manifest=/app/built-origins.env \
    && npm run build

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

ARG BACKEND_UPSTREAM=resumeflow-botism.zeabur.internal:8000
ARG VITE_API_BASE_URL
ARG VITE_FRONTEND_ORIGIN
ARG VITE_LOGTO_ENDPOINT
ARG VITE_LOGTO_APP_ID
ARG VITE_LOGTO_REDIRECT_URI
ARG VITE_LOGTO_ACCOUNT_CENTER_URL
ARG YIFUT_BASE_URL=https://www.yifut.com

# These runtime values are not used to rewrite Vite output. The entrypoint
# compares them with the immutable build manifest and fails closed on drift.
ENV BACKEND_UPSTREAM=$BACKEND_UPSTREAM \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_FRONTEND_ORIGIN=$VITE_FRONTEND_ORIGIN \
    VITE_LOGTO_ENDPOINT=$VITE_LOGTO_ENDPOINT \
    VITE_LOGTO_APP_ID=$VITE_LOGTO_APP_ID \
    VITE_LOGTO_REDIRECT_URI=$VITE_LOGTO_REDIRECT_URI \
    VITE_LOGTO_ACCOUNT_CENTER_URL=$VITE_LOGTO_ACCOUNT_CENTER_URL \
    YIFUT_BASE_URL=$YIFUT_BASE_URL \
    NGINX_ENVSUBST_FILTER='BACKEND_UPSTREAM|VITE_API_BASE_URL|VITE_LOGTO_ENDPOINT|YIFUT_BASE_URL'

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 tools/validate-production-origins.sh /docker-entrypoint.d/15-validate-production-origins.sh
COPY --from=builder --chmod=444 /app/built-origins.env /etc/resumeflow/built-origins.env
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
