#!/usr/bin/env bash
set -euo pipefail

# Configuration
STACK_NAME="${STACK_NAME:-tabs-chat-stack}"
REGION="${AWS_REGION:-eu-west-1}"
APP_DOMAIN="${APP_DOMAIN:-tabs.chat}"
: "${CERTIFICATE_ARN:?Set CERTIFICATE_ARN to the issued us-east-1 ACM certificate covering tabs.chat and www.tabs.chat}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "🚀 tabs.chat Deployment to AWS CloudFront + S3"
echo "=========================================="
echo "Region: $REGION"
echo "Stack:  $STACK_NAME"
echo ""

# 1. Build application
echo "📦 Step 1: Building tabs.chat hosted distribution..."
cd "$PROJECT_ROOT"
npm run build:hosted

# 2. Deploy CloudFormation Stack
echo ""
echo "☁️ Step 2: Deploying CloudFormation Stack (S3 + CloudFront OAC)..."
aws cloudformation deploy \
  --template-file "$PROJECT_ROOT/deploy/s3-cloudfront.yaml" \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --parameter-overrides DomainName="$APP_DOMAIN" CertificateArn="$CERTIFICATE_ARN" \
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
echo "📤 Step 4: Syncing static assets to S3..."

AWS_DEFAULT_REGION="$REGION" bash "$PROJECT_ROOT/deploy/upload.sh" "$PROJECT_ROOT/dist-hosted" "$BUCKET_NAME" "$DIST_ID"

echo ""
echo "✅ Deployment completed successfully!"
echo "🌐 Your tabs.chat instance is live at: $DIST_URL"
