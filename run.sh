#!/bin/bash
set -e

export GCP_PROJECT=k2o-dev
export GCP_CREDENTIALS="$(cat tmp/sa-key.json)"
export PORT=8080
export BASE_URL=https://localhost:8080
export DEPLOYMENT=local

(cd logic && npm install)
(cd logic && node src/index.js)