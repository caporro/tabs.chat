#!/usr/bin/env bash
set -e

# Configuration
STACK_NAME="achat-stack"
REGION="${AWS_REGION:-eu-west-1}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "🚀 AChat Deployment to AWS CloudFront + S3"
echo "=========================================="
echo "Region: $REGION"
echo "Stack:  $STACK_NAME"
echo ""

# 1. Build application
echo "📦 Step 1: Building AChat single-file distribution..."
cd "$PROJECT_ROOT"
npm run build

# 2. Deploy CloudFormation Stack
echo ""
echo "☁️ Step 2: Deploying CloudFormation Stack (S3 + CloudFront OAC)..."
aws cloudformation deploy \
  --template-file "$PROJECT_ROOT/deploy/s3-cloudfront.yaml" \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --no-fail-on-empty-changeset

# 3. Get Outputs
echo ""
echo "🔍 Step 3: Fetching Stack Outputs..."
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text)

DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)

DIST_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionURL'].OutputValue" \
  --output text)

echo "Bucket:          $BUCKET_NAME"
echo "Distribution ID: $DIST_ID"
echo "URL:             $DIST_URL"

# 4. Sync files to S3
echo ""
echo "📤 Step 4: Syncing index.html to S3..."
aws s3 cp "$PROJECT_ROOT/dist/index.html" "s3://$BUCKET_NAME/index.html" \
  --content-type "text/html" \
  --cache-control "public, max-age=0, must-revalidate"

# Also sync root files if any (e.g. manifest if present)
if [ -f "$PROJECT_ROOT/manifest.webmanifest" ]; then
  aws s3 cp "$PROJECT_ROOT/manifest.webmanifest" "s3://$BUCKET_NAME/manifest.webmanifest" \
    --content-type "application/manifest+json"
fi

# 5. Invalidate CloudFront Cache
echo ""
echo "🔄 Step 5: Creating CloudFront cache invalidation..."
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --query "Invalidation.Id" \
  --output text

echo ""
echo "✅ Deployment completed successfully!"
echo "🌐 Your AChat instance is live at: $DIST_URL"
