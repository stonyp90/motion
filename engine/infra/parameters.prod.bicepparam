using 'main.bicep'

param env = 'prod'
param location = 'westeurope'
param apiImageTag = 'latest'
param segmentImageTag = 'latest'
param renderImageTag = 'latest'
param openAiDeploymentName = 'gpt-5'
param openAiModelName = 'gpt-5'
param frontDoorSku = 'Premium_AzureFrontDoor'
param apiMinReplicas = 2
param apiMaxReplicas = 30

// SOC 2 CC4: 180-day Log Analytics retention for prod (audit window).
param logRetentionDays = 180

// SOC 2 CC6: CORS allowlist. Add real customer domains here as they
// come online. NEVER ['*'] in prod.
param corsAllowedOrigins = [
  'https://motion.ursly.io'
]
