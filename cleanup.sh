#!/bin/bash
set -e

echo "Stopping and removing Docker container 'kv2-local'..."
docker rm -f kv2-local || true

echo "Removing Docker image 'kv2-backend'..."
docker rmi -f kv2-backend || true

echo "Cleaning up dangling volumes (if any)..."
docker volume prune -f