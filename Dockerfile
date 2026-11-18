FROM node:22-alpine AS build
WORKDIR /app
COPY build.mjs THIRD_PARTY_NOTICES.txt ./
COPY src/ ./src/
RUN node build.mjs

FROM nginx:alpine

RUN printf '%s\n' \
    'server {' \
    '    listen 8080;' \
    '    server_name _;' \
    '    root /usr/share/nginx/html;' \
    '    index index.html;' \
    '}' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist/ /usr/share/nginx/html/

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
