FROM node:22-bookworm-slim AS node
FROM swift:6.0.3-jammy
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /workspace
