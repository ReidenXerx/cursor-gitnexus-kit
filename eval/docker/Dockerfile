FROM node:22-slim

# Install git (needed for gitnexus to track commits and for agent tools)
RUN apt-get update -qq && apt-get install -y -qq git rsync ca-certificates && rm -rf /var/lib/apt/lists/*

# Install gitnexus globally
RUN npm install -g gitnexus@latest

# Create a working directory
WORKDIR /workspace

# Default command — will be overridden by docker exec
CMD ["sleep", "infinity"]
