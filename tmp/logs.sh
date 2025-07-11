#!/usr/bin/env sh

gcloud run services logs read kv2-backend-service --region=us-west2 --project=k2o-dev --limit 50