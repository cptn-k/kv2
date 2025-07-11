#!/bin/bash

export GCP_PROJECT=k2o-dev
export GCP_CREDENTIALS="$(cat tmp/sa-key.json)"
export PORT=8080
export BASE_URL=https://localhost:8080
export DEPLOYMENT=local

USER_ID="0fa8a131-5022-407b-8ffb-1b541730f639"

(cd logic && node src/populate-cache.js "$USER_ID")