#!/bin/bash

./build.sh

set -e

IMAGE_NAME="kv2-backend"
EMULATOR_PORT=8080
PROJECT_ID="kv2-backend-local"

docker run -p 8080:8080 \
  -e GCP_CREDENTIALS="$(cat tmp/sa-key.json)" \
  --name kv2-local \
  $IMAGE_NAME

exit 0
