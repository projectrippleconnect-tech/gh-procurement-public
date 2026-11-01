FROM node:24-alpine
WORKDIR /app
COPY server.mjs /app/server.mjs
ENV PORT=3000
EXPOSE 3000
# Disposable readiness probe only; DO NOT use with WhatsApp credentials.
CMD ["node","/app/server.mjs"]
