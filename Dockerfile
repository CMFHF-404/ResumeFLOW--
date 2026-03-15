FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_BASE_URL
ARG VITE_LOGTO_ENDPOINT
ARG VITE_LOGTO_APP_ID
ARG VITE_LOGTO_REDIRECT_URI
ARG VITE_LOGTO_RESOURCE

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_LOGTO_ENDPOINT=$VITE_LOGTO_ENDPOINT \
    VITE_LOGTO_APP_ID=$VITE_LOGTO_APP_ID \
    VITE_LOGTO_REDIRECT_URI=$VITE_LOGTO_REDIRECT_URI \
    VITE_LOGTO_RESOURCE=$VITE_LOGTO_RESOURCE

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN test -n "$VITE_API_BASE_URL" \
    && test -n "$VITE_LOGTO_ENDPOINT" \
    && test -n "$VITE_LOGTO_APP_ID" \
    && test -n "$VITE_LOGTO_REDIRECT_URI" \
    && test -n "$VITE_LOGTO_RESOURCE" \
    && npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
