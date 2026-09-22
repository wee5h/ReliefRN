#!/usr/bin/env bash
# Run from macOS, Linux, or WSL with Azure CLI and Docker Desktop installed.
# Creates resources in a dedicated group; does not modify the Foundry project.
set -euo pipefail
set +x
umask 077
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

AZURE_LOCATION="${AZURE_LOCATION:-${1:-}}"
if [[ -z "$AZURE_LOCATION" ]]; then
  echo 'Usage: bash scripts/deploy-azure.sh <region-allowed-by-your-subscription>' >&2
  exit 1
fi
for command_name in az docker openssl; do
  command -v "$command_name" >/dev/null || { echo "Install $command_name first." >&2; exit 1; }
done
docker info >/dev/null
docker buildx version >/dev/null
SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
APP_NAME="${APP_NAME:-reliefrn-fema-mcp}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-$APP_NAME}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-$APP_NAME-env}"
IDENTITY_NAME="$APP_NAME-pull"
# Deterministic global registry name, including the chosen subscription and group.
REGISTRY_SUFFIX="$(printf '%s' "$SUBSCRIPTION_ID/$RESOURCE_GROUP/$APP_NAME" | openssl dgst -sha256 | awk '{print substr($NF,1,14)}')"
REGISTRY_NAME="${REGISTRY_NAME:-reliefrnfema$REGISTRY_SUFFIX}"
MIN_REPLICAS="${MIN_REPLICAS:-0}"
if [[ ! "$APP_NAME" =~ ^[a-z][a-z0-9-]{0,30}[a-z0-9]$ || "$APP_NAME" == *--* ]]; then
  echo 'APP_NAME must be 2..32 lowercase letters, digits, or single hyphens, starting with a letter.' >&2
  exit 1
fi
if [[ ! "$REGISTRY_NAME" =~ ^[a-z0-9]{5,50}$ || ! "$MIN_REPLICAS" =~ ^[01]$ ]]; then
  echo 'Use a 5..50 character lowercase alphanumeric registry name; MIN_REPLICAS must be 0 or 1.' >&2
  exit 1
fi

mkdir -p .azure
KEY_FILE=".azure/$APP_NAME-mcp-api-key"
if [[ -n "${MCP_API_KEY:-}" ]]; then
  printf '%s' "$MCP_API_KEY" > "$KEY_FILE"
elif [[ ! -s "$KEY_FILE" ]]; then
  openssl rand -hex 32 > "$KEY_FILE"
fi
MCP_API_KEY="$(cat "$KEY_FILE")"
if [[ ${#MCP_API_KEY} -lt 32 || "$MCP_API_KEY" =~ [[:space:]] ]]; then
  echo 'MCP_API_KEY must have at least 32 characters and no whitespace.' >&2
  exit 1
fi

echo "Using subscription $SUBSCRIPTION_ID; region $AZURE_LOCATION; group $RESOURCE_GROUP"
az extension add --name containerapp --upgrade --only-show-errors -o none
for namespace in Microsoft.App Microsoft.ContainerRegistry Microsoft.ManagedIdentity; do
  az provider register --namespace "$namespace" --wait --only-show-errors -o none
done
az group create --name "$RESOURCE_GROUP" --location "$AZURE_LOCATION" --only-show-errors -o none

if ! az acr show -n "$REGISTRY_NAME" -g "$RESOURCE_GROUP" --only-show-errors -o none 2>/dev/null; then
  az acr create --name "$REGISTRY_NAME" --resource-group "$RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" --sku Basic --role-assignment-mode rbac \
    --only-show-errors -o none
fi
LOGIN_SERVER="$(az acr show -n "$REGISTRY_NAME" -g "$RESOURCE_GROUP" --query loginServer -o tsv)"
REGISTRY_ID="$(az acr show -n "$REGISTRY_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)"
az acr login --name "$REGISTRY_NAME" --only-show-errors -o none
IMAGE="$LOGIN_SERVER/reliefrn-fema-mcp:$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 3)"
# Local build avoids requiring ACR Tasks. Go is needed only inside the builder.
docker buildx build --platform linux/amd64 --provenance=false --tag "$IMAGE" --push .

if ! az containerapp env show -n "$ENVIRONMENT_NAME" -g "$RESOURCE_GROUP" --only-show-errors -o none 2>/dev/null; then
  az containerapp env create --name "$ENVIRONMENT_NAME" --resource-group "$RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" --logs-destination none --only-show-errors -o none
fi
az identity create --name "$IDENTITY_NAME" --resource-group "$RESOURCE_GROUP" \
  --location "$AZURE_LOCATION" --only-show-errors -o none
IDENTITY_ID="$(az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)"
PRINCIPAL_ID="$(az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query principalId -o tsv)"
PULL_ROLE_COUNT="$(az role assignment list --scope "$REGISTRY_ID" \
  --query "[?principalId=='$PRINCIPAL_ID' && roleDefinitionName=='AcrPull'] | length(@)" -o tsv)"
if [[ "$PULL_ROLE_COUNT" == "0" ]]; then
  az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
    --role AcrPull --scope "$REGISTRY_ID" --only-show-errors -o none
fi

if az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" --only-show-errors -o none 2>/dev/null; then
  az containerapp secret set -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --secrets "mcp-api-key=$MCP_API_KEY" --only-show-errors -o none
  az containerapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" --image "$IMAGE" \
    --set-env-vars 'MCP_API_KEY=secretref:mcp-api-key' 'PORT=8080' \
    --min-replicas "$MIN_REPLICAS" --max-replicas 1 --cpu 0.25 --memory 0.5Gi \
    --only-show-errors -o none
else
  az containerapp create --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
    --environment "$ENVIRONMENT_NAME" --image "$IMAGE" \
    --user-assigned "$IDENTITY_ID" --registry-identity "$IDENTITY_ID" --registry-server "$LOGIN_SERVER" \
    --ingress external --target-port 8080 --transport http --revisions-mode single \
    --min-replicas "$MIN_REPLICAS" --max-replicas 1 --cpu 0.25 --memory 0.5Gi \
    --secrets "mcp-api-key=$MCP_API_KEY" \
    --env-vars 'MCP_API_KEY=secretref:mcp-api-key' 'PORT=8080' \
    --only-show-errors -o none
fi

FQDN="$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
if [[ -z "$FQDN" ]]; then
  echo 'Deployment has no ingress address. Check the Container App revision in Azure.' >&2
  exit 1
fi
printf 'https://%s/mcp\n' "$FQDN" > ".azure/$APP_NAME-mcp-url"
printf '%s\n' "$RESOURCE_GROUP" > ".azure/$APP_NAME-resource-group"
echo "MCP URL: https://$FQDN/mcp"
echo "Health URL: https://$FQDN/healthz"
echo "Foundry credential name: X-API-Key"
echo "Read the credential value from $KEY_FILE. It is not printed automatically."
echo 'Run scripts/smoke-test.py against the MCP URL before connecting Foundry.'
