FROM node:20-bullseye-slim

# Toolchains for direct-mode judging (used when Docker is not available, e.g. Render):
# g++ (C++), python3 (Python), a headless JDK (Java). Node itself comes from the base image.
RUN apt-get update && \
    apt-get install -y --no-install-recommends g++ build-essential python3 default-jdk-headless && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
