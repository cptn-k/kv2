#!/bin/bash
set -e

IMAGE_NAME="kv2-backend"

echo "Building Docker image: $IMAGE_NAME"
docker build -t $IMAGE_NAME .
