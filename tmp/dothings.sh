#!/bin/bash

# > Rename Secret
#ORIG_SECRET_NAME="OPENAI_API_KEY"
#NEW_SECRET_NAME="openai-api-key"
#secret_value=$(gcloud secrets versions access latest --secret="$ORIG_SECRET_NAME" --format="get(payload.data)" | base64 --decode)
#if ! gcloud secrets describe "$NEW_SECRET_NAME" &>/dev/null; then
#  gcloud secrets create "$NEW_SECRET_NAME" --replication-policy="automatic"
#fi
#echo -n "$secret_value" | gcloud secrets versions add "$NEW_SECRET_NAME" --data-file=-

# > Logs
# gcloud run services logs read kv2-backend-service --region=us-west2 --project=k2o-dev --limit=200

# Create a new secret with an initial value
NEW_SECRET_NAME="clickup-client-secret"
SECRET_VALUE="WCX11PB6ELTDUGQTX96HG51Z9ZOCU3JAU4CB7RHUSM1M72VVYIOJI6TOFLJGV4VJ"
echo -n "$SECRET_VALUE" | gcloud secrets create "$NEW_SECRET_NAME" \
  --data-file=- \


#gcloud run services update kv2-backend-service \
#  --region=us-west2 \
#  --no-traffic \
#  --project=k2o-dev


# > Kill switch
#gcloud run services delete kv2-backend-service \
#  --region=us-west2 \
#  --project=k2o-dev