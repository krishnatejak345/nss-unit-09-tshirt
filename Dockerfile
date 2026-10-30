# Production Dockerfile for NSS Unit 09 T-Shirt Registration & Payment Portal
FROM node:22-alpine

WORKDIR /app

# The application utilizes native Node 22 built-in modules (node:sqlite, node:http, node:crypto)
# No external npm packages or build compilation steps are required.
COPY . .

# Ensure directories for SQLite data and uploaded payment screenshots exist
RUN mkdir -p /app/data /app/public/uploads/screenshots

# Default environment variables
ENV NODE_ENV=production \
    PORT=5000 \
    HOST=0.0.0.0 \
    UNIT_PRICE_PAISE=38507 \
    TOTAL_STOCK_LIMIT=50 \
    RESERVATION_MINUTES=10 \
    UPI_ID=9491663928@ybl \
    UPI_NAME="NSS Unit 09"

EXPOSE 5000

CMD ["node", "server.js"]
