#!/bin/bash

# ================================================
# Ledgr - Create API Key Script
# ================================================
# Usage:
#   ./scripts/create-api-key.sh <business_id> "<key_name>"
#
# Example:
#   ./scripts/create-api-key.sh 123e4567-e89b-12d3-a456-426614174000 "Zapier Integration"
# ================================================

set -e

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <business_id> \"<key_name>\""
  echo ""
  echo "Example:"
  echo "  $0 123e4567-e89b-12d3-a456-426614174000 \"Zapier Integration\""
  exit 1
fi

BUSINESS_ID=$1
KEY_NAME=$2

# Load environment variables if .env exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$SUPABASE_PROJECT_REF" ]; then
  echo "❌ SUPABASE_PROJECT_REF is not set."
  echo "   Add it to your .env file or export it:"
  echo "   export SUPABASE_PROJECT_REF=your_project_ref"
  exit 1
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ SUPABASE_SERVICE_ROLE_KEY is not set."
  echo "   Add it to your .env file or export it."
  exit 1
fi

echo "🔑 Creating API key for business: $BUSINESS_ID"
echo "   Name: $KEY_NAME"
echo ""

RESPONSE=$(curl -s -X POST \
  "https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/create-api-key" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"business_id\": \"${BUSINESS_ID}\",
    \"name\": \"${KEY_NAME}\"
  }")

echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"

echo ""
echo "✅ Done. Copy the key above — it will not be shown again."