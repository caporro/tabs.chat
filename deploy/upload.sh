#!/usr/bin/env bash
set -euo pipefail

BUILD_DIR="${1:?Usage: upload.sh BUILD_DIR BUCKET_NAME DISTRIBUTION_ID}"
BUCKET_NAME="${2:?Bucket name is required}"
DIST_ID="${3:?CloudFront distribution ID is required}"
test -s "$BUILD_DIR/index.html"
test -s "$BUILD_DIR/js/app.js"

# Stable paths must revalidate. Immutable caching requires content-addressed names.
# Upload the entrypoint last, after its supporting resources are in place.
aws s3 sync "$BUILD_DIR/" "s3://$BUCKET_NAME/" \
  --delete --exclude index.html --cache-control 'public, max-age=0, must-revalidate' --only-show-errors
# Explicit MIME type for ESM; platform MIME databases differ for .mjs.
aws s3 cp "$BUILD_DIR/" "s3://$BUCKET_NAME/" --recursive \
  --exclude '*' --include '*.mjs' --content-type application/javascript \
  --cache-control 'public, max-age=0, must-revalidate' --only-show-errors
aws s3 cp "$BUILD_DIR/index.html" "s3://$BUCKET_NAME/index.html" \
  --content-type text/html --cache-control 'public, max-age=0, must-revalidate' --only-show-errors
INVALIDATION_ID=$(aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' --query Invalidation.Id --output text)
printf 'CloudFront invalidation: %s\n' "$INVALIDATION_ID"
aws cloudfront wait invalidation-completed --distribution-id "$DIST_ID" --id "$INVALIDATION_ID"
