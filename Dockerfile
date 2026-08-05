FROM apify/actor-node:22 AS builder
COPY package*.json ./
# The base image sets NODE_ENV=production, which makes npm skip devDependencies
# (typescript). --include=dev is required for the build stage.
RUN npm ci --include=dev
COPY . ./
RUN npm run build

FROM apify/actor-node:22
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /usr/src/app/dist ./dist
COPY .actor ./.actor
