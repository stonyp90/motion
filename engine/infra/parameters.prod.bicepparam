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
