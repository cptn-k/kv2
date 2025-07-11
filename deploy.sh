#!/bin/bash

set -euo pipefail

IMAGE_NAME="kv2-backend"
TAG="latest"
PROJECT_ID="k2o-dev"
REGION="us-west2"

# Check gcloud auth status
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "^"; then
    echo "No active gcloud account found. Please login."
    gcloud auth login
fi

docker build --platform=linux/amd64 -t $IMAGE_NAME .
docker tag $IMAGE_NAME gcr.io/$PROJECT_ID/$IMAGE_NAME:$TAG

gcloud auth configure-docker
docker push gcr.io/$PROJECT_ID/$IMAGE_NAME:$TAG

SERVICE_NAME="kv2-backend-service"

BASE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

SERVICE_ACCOUNT="kv2-backend-sa@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$IMAGE_NAME:$TAG \
  --platform managed \
  --region $REGION \
  --set-secrets GCP_CREDENTIALS=backend-sa-creds:latest \
  --update-env-vars BASE_URL=$BASE_URL,GCP_PROJECT=$PROJECT_ID \
  --service-account $SERVICE_ACCOUNT \
  --allow-unauthenticated \
  --no-invoker-iam-check