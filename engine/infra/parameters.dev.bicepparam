using 'main.bicep'

param env = 'dev'
param location = 'eastus'
param apiImageTag = 'latest'
param segmentImageTag = 'latest'
param renderImageTag = 'latest'

// Personal-subscription friendly defaults:
//   * No Azure OpenAI (often gated). API falls back to MOTION_FORGE_LLM_BACKEND env.
//   * No GPU workload profile (no quota on personal subs). Segment job skipped.
// Flip these to true once the sub has Cognitive Services + GPU quota approved.
param enableOpenAi = false
param enableGpuProfile = false
// Cosmos disabled for this iteration — a prior cancelled deploy left the
// account in a Failed provisioning state. Either delete that account
// manually (`az cosmosdb delete -g rg-motion-forge-dev -n cosmos-mf-dev-75mfz5z7mpzxk --yes`)
// or pick a new account name in `names.cosmos`, then flip this back to true.
param enableCosmos = false

param openAiDeploymentName = 'gpt-4o-mini'
param openAiModelName = 'gpt-4o-mini'
param frontDoorSku = 'Standard_AzureFrontDoor'
param apiMinReplicas = 1
param apiMaxReplicas = 3
