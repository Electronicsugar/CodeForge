# Sandbox image for every supported language.
# Build once:  docker build -t codeforge-runner:2.0 backend/src/services/executor/docker
# (override the tag with the RUNNER_IMAGE environment variable)
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        g++ python3 openjdk-21-jdk-headless nodejs time coreutils && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

CMD ["bash"]
