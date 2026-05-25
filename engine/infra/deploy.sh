#!/usr/bin/env bash
# motion-forge — one-shot Azure deploy.
#
#   ./deploy.sh --env dev --location eastus
#   ./deploy.sh --env prod --location westeurope --skip-push
#
# Prerequisites: az CLI >= 2.65, an Azure subscription with quota for the
# chosen GPU SKU, and Azure OpenAI access in the chosen region.

set -euo pipefail

ENV="dev"
LOCATION="eastus"
SKIP_PUSH=0
SKIP_INFRA=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)         ENV="$2"; shift 2 ;;
    --location)    LOCATION="$2"; shift 2 ;;
    --skip-push)   SKIP_PUSH=1; shift ;;
    --skip-infra)  SKIP_INFRA=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

RG="rg-motion-forge-${ENV}"
PARAM_FILE="parameters.${ENV}.bicepparam"

if [[ ! -f "${PARAM_FILE}" ]]; then
  echo "missing ${PARAM_FILE}" >&2
  exit 2
fi

echo ">> resource group: ${RG} (${LOCATION})"
az group create --name "${RG}" --location "${LOCATION}" --tags project=motion-forge env="${ENV}" managedBy=bicep >/dev/null

if [[ "${SKIP_INFRA}" -eq 0 ]]; then
  echo ">> bicep what-if (dry run)"
  az deployment group what-if --resource-group "${RG}" --template-file main.bicep --parameters "${PARAM_FILE}" || true

  echo ">> deploying main.bicep"
  az deployment group create \
    --resource-group "${RG}" \
    --name "mf-${ENV}-$(date +%Y%m%d%H%M%S)" \
    --template-file main.bicep \
    --parameters "${PARAM_FILE}" \
    --query "properties.provisioningState" -o tsv
fi

LAST_DEPLOY=$(az deployment group list -g "${RG}" --query "[0].name" -o tsv)
ACR_NAME=$(az deployment group show -g "${RG}" -n "${LAST_DEPLOY}" --query "properties.outputs.acrLoginServer.value" -o tsv | cut -d. -f1)
FRONT_DOOR=$(az deployment group show -g "${RG}" -n "${LAST_DEPLOY}" --query "properties.outputs.frontDoorEndpoint.value" -o tsv)

if [[ "${SKIP_PUSH}" -eq 0 ]]; then
  echo ">> az acr login --name ${ACR_NAME}"
  az acr login --name "${ACR_NAME}"

  echo ">> building images (api / segment / render) for linux/amd64"
  cd ..
  docker buildx build --platform linux/amd64 -t "${ACR_NAME}.azurecr.io/motion-forge-api:latest"     -f infra/docker/Dockerfile.api     .
  docker buildx build --platform linux/amd64 -t "${ACR_NAME}.azurecr.io/motion-forge-segment:latest" -f infra/docker/Dockerfile.segment .
  docker buildx build --platform linux/amd64 -t "${ACR_NAME}.azurecr.io/motion-forge-render:latest"  -f infra/docker/Dockerfile.render  .

  echo ">> pushing images"
  docker push "${ACR_NAME}.azurecr.io/motion-forge-api:latest"
  docker push "${ACR_NAME}.azurecr.io/motion-forge-segment:latest"
  docker push "${ACR_NAME}.azurecr.io/motion-forge-render:latest"

  cd infra
  echo ">> rolling out new revision"
  CURR_REVISION=$(az containerapp revision list -g "${RG}" -n "ca-mf-api-${ENV}" --query "[0].name" -o tsv 2>/dev/null || echo "")
  if [[ -n "${CURR_REVISION}" ]]; then
    az containerapp revision restart -g "${RG}" --name "ca-mf-api-${ENV}" --revision "${CURR_REVISION}" || true
  fi
fi

API_FQDN=$(az containerapp show -g "${RG}" -n "ca-mf-api-${ENV}" --query 'properties.configuration.ingress.fqdn' -o tsv 2>/dev/null || echo '<provisioning>')

echo
echo "============================================================="
echo " motion-forge ${ENV} deploy complete"
echo "  Front Door : ${FRONT_DOOR}"
echo "  API ingress: ${API_FQDN}"
echo
echo "  Health:    curl ${FRONT_DOOR}/healthz"
echo "  Themes:    curl ${FRONT_DOOR}/themes"
echo "  OpenAPI:   curl ${FRONT_DOOR}/openapi.json"
echo "============================================================="
