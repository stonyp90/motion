// motion-forge — single-file Azure infra
//
// Cost-effective, performance-effective, no-cold-start.
//
// Deploy:
//   az group create -n rg-motion-forge-dev -l eastus
//   az deployment group create -g rg-motion-forge-dev \
//       --template-file main.bicep \
//       --parameters parameters.dev.bicepparam
//
// All service-to-service auth uses a user-assigned Managed Identity. No
// connection strings are returned as outputs; consumers fetch them via
// `azure_credential` at runtime.

targetScope = 'resourceGroup'

// ---- parameters ----

@description('Environment slug used in resource names. Lowercase letters and digits only.')
@minLength(2)
@maxLength(8)
param env string = 'dev'

@description('Azure region for every resource.')
param location string = resourceGroup().location

@description('Image tag for mf-api. The CI pipeline bumps this on every revision.')
param apiImageTag string = 'latest'

@description('Image tag for the ControlCraft web frontend (Next.js standalone). The CI pipeline bumps this on every web push.')
param webImageTag string = 'latest'

@description('Image tag for the Keycloak identity provider (custom build with the motion-forge realm baked in).')
param keycloakImageTag string = 'latest'

@description('Image tag for the segment job.')
param segmentImageTag string = 'latest'

@description('Image tag for the render job.')
param renderImageTag string = 'latest'

@description('Per-deploy timestamp salt for ACA revisionSuffix uniqueness. Defaults to utcNow() so every deployment produces fresh suffixes even when image tags are unchanged (otherwise web-deploy.yml — which only passes webImageTag — would collide with prior revisions of the api/keycloak apps whose tag stays at the default `latest`).')
param deployTimestamp string = utcNow('yyyyMMddHHmmss')

// NOTE: `postgresAdminLogin`, `postgresLocation`, `postgresAdminPassword`
// were removed when Keycloak pivoted to H2-on-Azure-Files because the
// personal-tier sub is offer-restricted for PG-FS in every region we
// tried. The Bicep `--parameters postgresAdminPassword=…` in the
// workflows is now harmless (Bicep ignores unknown params unless
// `--parameters file.bicepparam` is used, which it isn't here).

@secure()
@description('Keycloak bootstrap admin password. Used for the initial /admin login on the master realm; rotate via Keycloak admin UI post-deploy. The Keycloak container reads this from a Container Apps secret reference.')
param keycloakAdminPassword string = newGuid()

@description('GPU workload-profile SKU for the segment job. Default NC8as-T4 (~$1.20/hr). Requires GPU quota.')
param gpuProfileType string = 'Consumption-GPU-NC8as-T4'

@description('Enable the GPU workload profile + segment job. Set false on subscriptions without GPU quota; the API + render pipeline still deploys.')
param enableGpuProfile bool = true

@description('CPU workload-profile SKU name. Default D4 (4 vCPU / 16 GiB).')
param cpuProfileName string = 'd4-render'

@description('Enable Azure OpenAI account + deployment. Requires Cognitive Services access (often gated on personal subs). When false, the API falls back to MOTION_FORGE_LLM_BACKEND env (anthropic, openai, ollama, mock).')
param enableOpenAi bool = true

@description('Enable Cosmos DB serverless. When false the API runs without a project index — useful to skip past a failed Cosmos provisioning while you sort it out separately.')
param enableCosmos bool = true

@description('Mount the Azure Files NFS share into the API + segment containers. Requires the Container Apps Environment to be on a custom VNet (BYOVNet). Off by default since BYOVNet is a heavier setup.')
param enableNfsModelMount bool = false

@description('Log Analytics retention in days. SOC 2 CC4 requires 90 days minimum; bump to 180 for production.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 90

@description('CORS allowed origins for the API container. Default locks to localhost + the controlcraft.io public domain + the ursly subdomain (legacy). Set to [] to disable CORS entirely. Avoid [\'*\'] in production (SOC 2 CC6).')
param corsAllowedOrigins array = [
  'http://localhost:3001'
  'http://localhost:3007'
  'https://controlcraft.io'
  'https://www.controlcraft.io'
  'https://app.controlcraft.io'
  'https://motion.ursly.io'
]

@description('Azure OpenAI model deployment name (e.g., gpt-5, gpt-4o, phi-4).')
param openAiDeploymentName string = 'gpt-5'

@description('OpenAI model name as published in Azure OpenAI service catalog.')
param openAiModelName string = 'gpt-5'

@description('OpenAI model version. Empty string uses the deployment default.')
param openAiModelVersion string = ''

@description('Front Door SKU. Standard_AzureFrontDoor is sufficient for dev; Premium for prod (adds WAF + private link origins).')
@allowed([
  'Standard_AzureFrontDoor'
  'Premium_AzureFrontDoor'
])
param frontDoorSku string = 'Standard_AzureFrontDoor'

@description('Min replicas for the API. Keep at 1 for the no-cold-start guarantee.')
@minValue(0)
@maxValue(10)
param apiMinReplicas int = 1

@description('Max replicas for the API.')
@minValue(1)
@maxValue(100)
param apiMaxReplicas int = 10

@description('Min replicas for the web app. 1 = warm; 0 saves $$ but adds cold-start.')
@minValue(0)
@maxValue(10)
param webMinReplicas int = 1

@description('Max replicas for the web app.')
@minValue(1)
@maxValue(100)
param webMaxReplicas int = 5

@description('Tags applied to every resource.')
param tags object = {
  project: 'motion-forge'
  env: env
  managedBy: 'bicep'
}

// ---- naming ----
var suffix = uniqueString(resourceGroup().id, env)
var names = {
  identity:    'mid-mf-${env}-${suffix}'
  acr:         'crmf${env}${take(suffix, 8)}' // ACR names: alphanumeric, no hyphens
  blob:        'stmf${env}${take(suffix, 8)}'
  files:       'stmffs${env}${take(suffix, 8)}'
  cosmos:      'cosmos-mf-${env}-${suffix}'
  redis:       'redis-mf-${env}-${suffix}'
  keyVault:    'kv-mf-${env}-${take(suffix, 8)}'
  workspace:   'log-mf-${env}-${suffix}'
  appInsights: 'appi-mf-${env}-${suffix}'
  openAi:      'oai-mf-${env}-${suffix}'
  acaEnv:      'cae-mf-${env}-${suffix}'
  apiApp:      'ca-mf-api-${env}'
  webApp:      'ca-controlcraft-web-${env}'
  keycloakApp: 'ca-controlcraft-keycloak-${env}'
  // Azure Files SMB share that Keycloak's H2 file DB lives on + the
  // ACA env storage definition that mounts it into the container.
  keycloakDataShare:   'keycloakdata'
  keycloakDataStorage: 'keycloak-data'
  segmentJob:  'caj-mf-segment-${env}'
  renderJob:   'caj-mf-render-${env}'
  jobQueue:    'jobs'
  outputContainer: 'outputs'
  workdirContainer: 'workdirs'
  fdProfile:   'fd-mf-${env}-${suffix}'
  fdEndpoint:  'mf-${env}-${suffix}'
  // No `fdEndpointWeb` — the web is served straight off its ACA
  // ingress (ACA provides automatic TLS for `*.azurecontainerapps.io`
  // and binds custom domains via `az containerapp hostname add` with
  // a free managed cert). AFD added latency + cost without a payoff
  // for this surface; revive if/when we need WAF or edge cache.
}

// ---- identity ----

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: names.identity
  location: location
  tags: tags
}

// ---- observability ----

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: names.workspace
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: names.appInsights
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// ---- container registry ----

resource acr 'Microsoft.ContainerRegistry/registries@2024-11-01-preview' = {
  name: names.acr
  location: location
  tags: tags
  sku: { name: 'Premium' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
  }
}

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, managedIdentity.id, 'AcrPull')
  scope: acr
  properties: {
    // built-in AcrPull role
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---- storage (blob + files) ----

resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: names.blob
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false // force Managed Identity
    supportsHttpsTrafficOnly: true
    networkAcls: { defaultAction: 'Allow' } // tighten to VNet when private endpoints land
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
  }
}

resource workdirContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: names.workdirContainer
  properties: {
    publicAccess: 'None'
  }
}

resource outputContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: names.outputContainer
  properties: {
    publicAccess: 'None'
  }
}

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2024-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'workdirs-tiering'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: [ 'blockBlob' ], prefixMatch: [ names.workdirContainer ] }
            actions: {
              baseBlob: {
                tierToCool: { daysAfterModificationGreaterThan: 7 }
                tierToArchive: { daysAfterModificationGreaterThan: 30 }
                delete: { daysAfterModificationGreaterThan: 180 }
              }
            }
          }
        }
        {
          name: 'outputs-tiering'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: [ 'blockBlob' ], prefixMatch: [ names.outputContainer ] }
            actions: {
              baseBlob: {
                tierToCool: { daysAfterModificationGreaterThan: 30 }
                tierToArchive: { daysAfterModificationGreaterThan: 90 }
              }
            }
          }
        }
      ]
    }
  }
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2024-01-01' = {
  parent: storage
  name: 'default'
}

resource jobQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2024-01-01' = {
  parent: queueService
  name: names.jobQueue
}

resource storageBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, managedIdentity.id, 'StorageBlobDataContributor')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageQueueDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, managedIdentity.id, 'StorageQueueDataContributor')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88')
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---- Azure Files (shared FS) ----

resource filesAccount 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: names.files
  location: location
  tags: tags
  sku: { name: 'Premium_LRS' }
  kind: 'FileStorage'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    networkAcls: { defaultAction: 'Allow' }
    azureFilesIdentityBasedAuthentication: { directoryServiceOptions: 'None' }
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2024-01-01' = {
  parent: filesAccount
  name: 'default'
  properties: {
    protocolSettings: { smb: { versions: 'SMB3.1.1' } }
  }
}

resource modelsShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2024-01-01' = {
  parent: fileService
  name: 'models'
  properties: {
    shareQuota: 100
    enabledProtocols: 'NFS'
    accessTier: 'Premium'
  }
}

// SMB share that Keycloak uses for its file-backed H2 database.
// Mounted at /opt/keycloak/data inside the Keycloak ACA container.
// Single-replica only (H2 has file locks) — we already run Keycloak
// at minReplicas=maxReplicas=1, so this is fine. Migrate to a hosted
// PG when the sub gets PG-FS quota.
resource keycloakDataShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2024-01-01' = {
  parent: fileService
  name: 'keycloakdata'
  properties: {
    // Premium_LRS FileStorage requires shareQuota >= 100 GB. Keycloak's
    // H2 file will use << 1 GB; the 100 GB minimum is just the floor.
    // Cost ~$18/month at Premium pricing.
    shareQuota: 100
    enabledProtocols: 'SMB'
    accessTier: 'Premium'
  }
}

// ---- cosmos DB (optional) ----

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = if (enableCosmos) {
  name: names.cosmos
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [ { locationName: location, failoverPriority: 0, isZoneRedundant: false } ]
    capabilities: [ { name: 'EnableServerless' } ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    disableLocalAuth: true // enforce Managed Identity
    publicNetworkAccess: 'Enabled'
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = if (enableCosmos) {
  parent: cosmos
  name: 'motion_forge'
  properties: { resource: { id: 'motion_forge' } }
}

resource projectsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = if (enableCosmos) {
  parent: cosmosDb
  name: 'projects'
  properties: {
    resource: {
      id: 'projects'
      partitionKey: { paths: [ '/tenantId' ], kind: 'Hash' }
      indexingPolicy: { indexingMode: 'consistent', automatic: true }
    }
  }
}

resource jobsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = if (enableCosmos) {
  parent: cosmosDb
  name: 'jobs'
  properties: {
    resource: {
      id: 'jobs'
      partitionKey: { paths: [ '/jobId' ], kind: 'Hash' }
      defaultTtl: 2592000 // 30 days
      indexingPolicy: { indexingMode: 'consistent', automatic: true }
    }
  }
}

// Cosmos data-plane role assignment for our identity.
resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = if (enableCosmos) {
  parent: cosmos
  name: guid(cosmos.id, managedIdentity.id, 'data-contributor')
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002' // built-in data contributor
    principalId: managedIdentity.properties.principalId
    scope: cosmos.id
  }
}

// ---- Postgres (deferred) ----------------------------------------------
//
// The personal-tier sub is offer-restricted on `Microsoft.DBforPostgreSQL/
// flexibleServers` in every region we tried (eastus + eastus2). Until
// the quota request clears, Keycloak runs in dev-file mode (H2) with
// its data persisted to an Azure Files SMB share (`keycloakdata` above).
//
// Migration path once PG-FS is available:
//   1. Provision the PG Flexible Server (resource block kept in git
//      history at commit 26473040511's parent — `git show HEAD~2 -- engine/infra/main.bicep`).
//   2. Set KC_DB=postgres + KC_DB_URL in the Keycloak app.
//   3. Run `kc.sh export --realm controlcraft` against the H2 instance,
//      copy the JSON, run `kc.sh import` against the new PG-backed
//      instance.

// ---- Redis ----

resource redis 'Microsoft.Cache/redis@2024-11-01' = {
  name: names.redis
  location: location
  tags: tags
  properties: {
    sku: { name: 'Basic', family: 'C', capacity: 0 }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisConfiguration: { 'aad-enabled': 'true' }
  }
}

// ---- Key Vault ----

resource keyVault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: names.keyVault
  location: location
  tags: tags
  properties: {
    sku: { name: 'standard', family: 'A' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: null
    publicNetworkAccess: 'Enabled'
  }
}

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, managedIdentity.id, 'KeyVaultSecretsUser')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---- Azure OpenAI (optional) ----

resource openAi 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (enableOpenAi) {
  name: names.openAi
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: names.openAi
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

resource openAiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (enableOpenAi) {
  parent: openAi
  name: openAiDeploymentName
  sku: { name: 'Standard', capacity: 50 } // 50 TPM units; raise for prod
  properties: {
    model: {
      format: 'OpenAI'
      name: openAiModelName
      version: empty(openAiModelVersion) ? null : openAiModelVersion
    }
    versionUpgradeOption: 'OnceCurrentVersionExpired'
  }
}

resource openAiUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (enableOpenAi) {
  name: guid(resourceGroup().id, managedIdentity.id, 'CognitiveServicesOpenAIUser')
  scope: openAi
  properties: {
    // Cognitive Services OpenAI User
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---- Container Apps Environment with Workload Profiles ----

resource acaEnv 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: names.acaEnv
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
    workloadProfiles: enableGpuProfile ? [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
      { name: cpuProfileName, workloadProfileType: 'D4', minimumCount: 0, maximumCount: 3 }
      { name: 'gpu-t4', workloadProfileType: gpuProfileType, minimumCount: 0, maximumCount: 2 }
    ] : [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
      { name: cpuProfileName, workloadProfileType: 'D4', minimumCount: 0, maximumCount: 3 }
    ]
    zoneRedundant: false
  }
}

// Storage mount for shared models share (Azure Files NFS).
// Conditional: requires the env to be on a custom VNet.
resource acaStorage 'Microsoft.App/managedEnvironments/storages@2025-01-01' = if (enableNfsModelMount) {
  parent: acaEnv
  name: 'models'
  properties: {
    nfsAzureFile: {
      server: '${filesAccount.name}.file.${environment().suffixes.storage}'
      shareName: '/${filesAccount.name}/models'
      accessMode: 'ReadOnly'
    }
  }
}

// SMB-mounted Files share for Keycloak's H2 database. Single replica
// only — H2 file locking prevents concurrent writers. The storage
// account key is fetched at deploy time and stored as an ACA env
// secret; the Keycloak app references this storage by name when it
// declares its volume.
resource acaKeycloakStorage 'Microsoft.App/managedEnvironments/storages@2025-01-01' = {
  parent: acaEnv
  name: names.keycloakDataStorage
  properties: {
    azureFile: {
      accountName: filesAccount.name
      accountKey: filesAccount.listKeys().keys[0].value
      shareName: names.keycloakDataShare
      accessMode: 'ReadWrite'
    }
  }
  dependsOn: [ keycloakDataShare ]
}

// ---- mf-api: always-warm axum HTTP service ----

resource apiApp 'Microsoft.App/containerApps@2025-01-01' = {
  name: names.apiApp
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${managedIdentity.id}': {} }
  }
  properties: {
    managedEnvironmentId: acaEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 7755
        // axum speaks HTTP/1.1 by default; 'auto' lets ACA detect h1c vs h2c.
        transport: 'auto'
        allowInsecure: false
        traffic: [ { latestRevision: true, weight: 100 } ]
        // CORS allowlist = static origins from `corsAllowedOrigins`
        // (includes https://motion.ursly.io) + the ACA web ingress
        // hostname constructed from `names.webApp` + the ACA env's
        // `defaultDomain`. We construct the URL instead of reading
        // `webApp.properties.…fqdn` so apiApp doesn't depend on
        // webApp — webApp already depends on apiApp (engine URL env),
        // and the reverse would be a Bicep cycle (BCP080). Never ship
        // `['*']` to production — SOC 2 CC6 considers it broken.
        corsPolicy: {
          allowedOrigins: union(
            corsAllowedOrigins,
            [ 'https://${names.webApp}.${acaEnv.properties.defaultDomain}' ]
          )
          allowedMethods: [ 'GET', 'POST', 'OPTIONS' ]
          allowedHeaders: [ 'authorization', 'content-type', 'accept', 'origin' ]
          maxAge: 600
          allowCredentials: false
        }
      }
      registries: [
        { server: acr.properties.loginServer, identity: managedIdentity.id }
      ]
      secrets: []
      maxInactiveRevisions: 2
    }
    template: {
      revisionSuffix: substring(uniqueString(apiImageTag, deployTimestamp), 0, 6)
      containers: [
        {
          name: 'api'
          image: '${acr.properties.loginServer}/motion-forge-api:${apiImageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'RUST_LOG', value: 'info,motion_forge=info' }
            { name: 'MOTION_FORGE_LLM_TIMEOUT_SEC', value: '30' }
            { name: 'AZURE_CLIENT_ID', value: managedIdentity.properties.clientId }
            { name: 'AZURE_OPENAI_ENDPOINT', value: enableOpenAi ? openAi.properties.endpoint : '' }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: enableOpenAi ? openAiDeploymentName : '' }
            { name: 'MOTION_FORGE_BLOB_ACCOUNT', value: storage.name }
            { name: 'MOTION_FORGE_BLOB_WORKDIRS', value: names.workdirContainer }
            { name: 'MOTION_FORGE_BLOB_OUTPUTS', value: names.outputContainer }
            { name: 'MOTION_FORGE_QUEUE_NAME', value: names.jobQueue }
            { name: 'MOTION_FORGE_COSMOS_ENDPOINT', value: enableCosmos ? cosmos.properties.documentEndpoint : '' }
            { name: 'MOTION_FORGE_REDIS_HOST', value: '${redis.name}.redis.cache.windows.net' }
            // Keycloak issuer for JWT validation in `crates/http/auth.rs`.
            // The realm-scoped URL matches the audience claim that the
            // web frontend's `/api/auth/*` routes mint.
            { name: 'KEYCLOAK_ISSUER',   value: 'https://${names.keycloakApp}.${acaEnv.properties.defaultDomain}/realms/controlcraft' }
            { name: 'KEYCLOAK_AUDIENCE', value: 'motion-forge-web,motion-forge-engine' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
          volumeMounts: enableNfsModelMount ? [ { volumeName: 'models', mountPath: '/models' } ] : []
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 7755 }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/healthz', port: 7755 }
              periodSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Startup'
              httpGet: { path: '/healthz', port: 7755 }
              periodSeconds: 5
              failureThreshold: 12
            }
          ]
        }
      ]
      scale: {
        minReplicas: apiMinReplicas
        maxReplicas: apiMaxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: { metadata: { concurrentRequests: '50' } }
          }
        ]
      }
      volumes: enableNfsModelMount ? [ { name: 'models', storageType: 'NfsAzureFile', storageName: 'models' } ] : []
    }
  }
  dependsOn: [ acrPullRoleAssignment, storageBlobDataContributor ]
}

// ---- managed cert for www.controlcraft.io (auto-issued by ACA) -------
//
// ACA's managed certificates use Let's Encrypt under the hood. Renewal
// is automatic + lifecycle-managed (90-day cert, renewed ~30 days
// before expiry). First provision requires DNS to already point at the
// app's ingress FQDN — once that's true, `domainControlValidation:
// CNAME` lets ACA verify ownership without a separate TXT record.

// Cert name matches the one CLI-issued during the first manual bind
// (`az containerapp hostname bind --validation-method CNAME` auto-names
// the cert `mc-<acaEnvName>-<hostname>-<suffix>`). Reusing the exact
// name lets Bicep adopt the existing cert as part of its desired state
// instead of trying to create a duplicate (which errors with
// DuplicateManagedCertificateInEnvironment). The cert's subjectName +
// validation method must match what was originally provisioned.
resource webManagedCert 'Microsoft.App/managedEnvironments/managedCertificates@2025-01-01' = {
  parent: acaEnv
  name: 'mc-cae-mf-dev-75m-www-controlcraft-9785'
  location: location
  tags: tags
  properties: {
    subjectName: 'www.controlcraft.io'
    domainControlValidation: 'CNAME'
  }
}

// ---- controlcraft-web: Next.js standalone server, public ingress ----
//
// Same Consumption workload profile as the API. The image is built by
// .github/workflows/web-deploy-azure.yml and pushed to the same ACR as
// the engine images. CORS is not needed here — the web server only
// responds to its own domain.

resource webApp 'Microsoft.App/containerApps@2025-01-01' = {
  name: names.webApp
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${managedIdentity.id}': {} }
  }
  properties: {
    managedEnvironmentId: acaEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [ { latestRevision: true, weight: 100 } ]
        // Custom-domain binding survives every Bicep apply. Without
        // this declared in Bicep, each redeploy strips the binding +
        // requires a manual `az containerapp hostname add` + `bind`.
        // The managedCertificate resource below auto-renews the Let's
        // Encrypt cert; first deploy needs DNS already in place
        // (CNAME www → ACA FQDN + TXT asuid.www → env verificationId).
        customDomains: [
          {
            name: 'www.controlcraft.io'
            bindingType: 'SniEnabled'
            certificateId: webManagedCert.id
          }
        ]
      }
      registries: [
        { server: acr.properties.loginServer, identity: managedIdentity.id }
      ]
      secrets: [
        // motion-forge-web client secret from the realm export. The
        // value lives in engine/infra/keycloak/realm-export.json
        // (`secret` field on the `motion-forge-web` client). Mirror it
        // here so the web container can talk to /token without the
        // value showing up in the env directly.
        { name: 'kc-client-secret',  value: 'motion-forge-web-dev-secret' }
        { name: 'kc-admin-password', value: keycloakAdminPassword }
      ]
      maxInactiveRevisions: 2
    }
    template: {
      revisionSuffix: substring(uniqueString(webImageTag, deployTimestamp), 0, 6)
      containers: [
        {
          name: 'web'
          image: '${acr.properties.loginServer}/controlcraft-web:${webImageTag}'
          // Next standalone server is light — 0.25 vCPU / 0.5 GiB
          // handles ~50 rps before autoscale needs to step in.
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'HOSTNAME', value: '0.0.0.0' }
            // Keycloak wiring — the realm-scoped issuer is what the
            // `/api/auth/{register,login,refresh}` route handlers
            // hit via `lib/server/keycloak.ts`.
            { name: 'KEYCLOAK_ISSUER',         value: 'https://${names.keycloakApp}.${acaEnv.properties.defaultDomain}/realms/controlcraft' }
            { name: 'KEYCLOAK_CLIENT_ID',      value: 'motion-forge-web' }
            { name: 'KEYCLOAK_CLIENT_SECRET',  secretRef: 'kc-client-secret' }
            { name: 'KEYCLOAK_ADMIN_USER',     value: 'admin' }
            { name: 'KEYCLOAK_ADMIN_PASSWORD', secretRef: 'kc-admin-password' }
            // Server-side proxy in `app/api/engine/file/route.ts` calls
            // the engine via internal-ACA hostname. Using FQDN keeps
            // CORS off the critical path (same Front Door domain).
            { name: 'ENGINE_BASE_URL', value: 'https://${apiApp.properties.configuration.ingress.fqdn}' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/', port: 3000 }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/', port: 3000 }
              periodSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Startup'
              httpGet: { path: '/', port: 3000 }
              periodSeconds: 5
              failureThreshold: 12
            }
          ]
        }
      ]
      scale: {
        minReplicas: webMinReplicas
        maxReplicas: webMaxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: { metadata: { concurrentRequests: '100' } }
          }
        ]
      }
    }
  }
  dependsOn: [ acrPullRoleAssignment ]
}

// ---- controlcraft-keycloak: identity provider, public ingress ----------------
//
// Custom image (built from engine/infra/docker/Dockerfile.keycloak)
// with the motion-forge realm export baked in — first boot runs
// `kc.sh start --optimized --import-realm` which creates the realm,
// clients, and seed users.
//
// Hostname: KC_HOSTNAME must match the public URL the web frontend
// uses to talk to Keycloak. We construct it from `names.keycloakApp`
// + the ACA env's `defaultDomain` so the value is right on first deploy
// without an extra "stamp the hostname after deploy" step.

resource keycloakApp 'Microsoft.App/containerApps@2025-01-01' = {
  name: names.keycloakApp
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${managedIdentity.id}': {} }
  }
  properties: {
    managedEnvironmentId: acaEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
        traffic: [ { latestRevision: true, weight: 100 } ]
      }
      registries: [
        { server: acr.properties.loginServer, identity: managedIdentity.id }
      ]
      secrets: [
        { name: 'kc-admin-pw', value: keycloakAdminPassword }
      ]
      maxInactiveRevisions: 2
    }
    template: {
      revisionSuffix: substring(uniqueString(keycloakImageTag, deployTimestamp), 0, 6)
      containers: [
        {
          name: 'keycloak'
          image: '${acr.properties.loginServer}/controlcraft-keycloak:${keycloakImageTag}'
          // Keycloak idles ~250 MB; 0.5 vCPU / 1 GiB handles ~50 logins/s.
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            // H2 file-backed DB on the Azure Files SMB mount at
            // /opt/keycloak/data. KC_DB=dev-file is the official
            // mode for single-replica with persistent state.
            { name: 'KC_DB', value: 'dev-file' }
            // Bootstrap admin — used only for the first login to the
            // master realm. Rotate via Keycloak's own UI post-deploy.
            { name: 'KC_BOOTSTRAP_ADMIN_USERNAME', value: 'admin' }
            { name: 'KC_BOOTSTRAP_ADMIN_PASSWORD', secretRef: 'kc-admin-pw' }
            // Public hostname (no scheme, no port). Keycloak needs
            // this to issue valid OIDC URLs.
            { name: 'KC_HOSTNAME',         value: '${names.keycloakApp}.${acaEnv.properties.defaultDomain}' }
            { name: 'KC_HOSTNAME_STRICT',  value: 'false' }
            { name: 'KC_PROXY_HEADERS',    value: 'xforwarded' }
            { name: 'KC_HTTP_ENABLED',     value: 'true' }
            { name: 'KC_HEALTH_ENABLED',   value: 'true' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
          // Persist the H2 file across container restarts. Without
          // this, every revision flush wipes the realm + users.
          volumeMounts: [
            { volumeName: 'kcdata', mountPath: '/opt/keycloak/data' }
          ]
          probes: [
            // Keycloak's /health endpoints live under /health/{live,ready,started}
            // when KC_HEALTH_ENABLED=true. Use the management port-less
            // path (KC_HEALTH_ENABLED exposes it on the same 8080).
            {
              type: 'Liveness'
              httpGet: { path: '/health/live', port: 9000 }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 9000 }
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Startup'
              httpGet: { path: '/health/started', port: 9000 }
              periodSeconds: 10
              failureThreshold: 30   // Realm import on first boot can take ~2 min
            }
          ]
        }
      ]
      scale: {
        // Single replica is mandatory while we run H2 — the file lock
        // would prevent any second replica from booting. Migrate to PG
        // before scaling out.
        minReplicas: 1
        maxReplicas: 1
      }
      volumes: [
        {
          name: 'kcdata'
          storageType: 'AzureFile'
          storageName: names.keycloakDataStorage
        }
      ]
    }
  }
  dependsOn: [
    acrPullRoleAssignment
    acaKeycloakStorage
  ]
}

// ---- mf-segment-job: GPU-backed SAM 2 job (optional) ----

resource segmentJob 'Microsoft.App/jobs@2025-01-01' = if (enableGpuProfile) {
  name: names.segmentJob
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${managedIdentity.id}': {} }
  }
  properties: {
    environmentId: acaEnv.id
    workloadProfileName: 'gpu-t4'
    configuration: {
      triggerType: 'Event'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      eventTriggerConfig: {
        replicaCompletionCount: 1
        parallelism: 1
        scale: {
          minExecutions: 0
          maxExecutions: 5
          pollingInterval: 30
          rules: [
            {
              name: 'queue-depth'
              type: 'azure-queue'
              identity: managedIdentity.id
              metadata: {
                accountName: storage.name
                queueName: names.jobQueue
                queueLength: '1'
              }
            }
          ]
        }
      }
      registries: [
        { server: acr.properties.loginServer, identity: managedIdentity.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'segment'
          image: '${acr.properties.loginServer}/motion-forge-segment:${segmentImageTag}'
          resources: { cpu: json('8'), memory: '56Gi' }
          env: [
            { name: 'AZURE_CLIENT_ID', value: managedIdentity.properties.clientId }
            { name: 'MOTION_FORGE_BLOB_ACCOUNT', value: storage.name }
            { name: 'MOTION_FORGE_QUEUE_NAME', value: names.jobQueue }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
          volumeMounts: enableNfsModelMount ? [ { volumeName: 'models', mountPath: '/models' } ] : []
        }
      ]
      volumes: enableNfsModelMount ? [ { name: 'models', storageType: 'NfsAzureFile', storageName: 'models' } ] : []
    }
  }
  dependsOn: [ acrPullRoleAssignment, storageBlobDataContributor, storageQueueDataContributor ]
}

// ---- mf-render-job: CPU-backed lottie→MP4 job ----

resource renderJob 'Microsoft.App/jobs@2025-01-01' = {
  name: names.renderJob
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${managedIdentity.id}': {} }
  }
  properties: {
    environmentId: acaEnv.id
    workloadProfileName: cpuProfileName
    configuration: {
      triggerType: 'Event'
      replicaTimeout: 1200
      replicaRetryLimit: 2
      eventTriggerConfig: {
        replicaCompletionCount: 1
        parallelism: 2
        scale: {
          minExecutions: 0
          maxExecutions: 10
          pollingInterval: 15
          rules: [
            {
              name: 'render-queue'
              type: 'azure-queue'
              identity: managedIdentity.id
              metadata: {
                accountName: storage.name
                queueName: '${names.jobQueue}-render'
                queueLength: '1'
              }
            }
          ]
        }
      }
      registries: [
        { server: acr.properties.loginServer, identity: managedIdentity.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'render'
          image: '${acr.properties.loginServer}/motion-forge-render:${renderImageTag}'
          resources: { cpu: json('4'), memory: '16Gi' }
          env: [
            { name: 'AZURE_CLIENT_ID', value: managedIdentity.properties.clientId }
            { name: 'MOTION_FORGE_BLOB_ACCOUNT', value: storage.name }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
        }
      ]
    }
  }
  dependsOn: [ acrPullRoleAssignment, storageBlobDataContributor, storageQueueDataContributor ]
}

// ---- Azure Front Door (edge + WAF + CDN) ----

resource fdProfile 'Microsoft.Cdn/profiles@2024-09-01' = {
  name: names.fdProfile
  location: 'global'
  tags: tags
  sku: { name: frontDoorSku }
  properties: { originResponseTimeoutSeconds: 120 }
}

resource fdEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-09-01' = {
  parent: fdProfile
  name: names.fdEndpoint
  location: 'global'
  tags: tags
  properties: { enabledState: 'Enabled' }
}

resource fdOriginGroup 'Microsoft.Cdn/profiles/originGroups@2024-09-01' = {
  parent: fdProfile
  name: 'api-origins'
  properties: {
    loadBalancingSettings: { sampleSize: 4, successfulSamplesRequired: 3 }
    healthProbeSettings: {
      probePath: '/healthz'
      probeRequestType: 'GET'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 30
    }
  }
}

resource fdOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2024-09-01' = {
  parent: fdOriginGroup
  name: 'aca-api'
  properties: {
    hostName: apiApp.properties.configuration.ingress.fqdn
    originHostHeader: apiApp.properties.configuration.ingress.fqdn
    httpsPort: 443
    httpPort: 80
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
  }
}

resource fdRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-09-01' = {
  parent: fdEndpoint
  name: 'default'
  properties: {
    originGroup: { id: fdOriginGroup.id }
    supportedProtocols: [ 'Https' ]
    patternsToMatch: [ '/*' ]
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    linkToDefaultDomain: 'Enabled'
    cacheConfiguration: {
      queryStringCachingBehavior: 'IgnoreQueryString'
      compressionSettings: {
        contentTypesToCompress: [
          'application/json'
          'application/xml'
          'text/css'
          'text/html'
          'text/javascript'
          'text/plain'
        ]
        isCompressionEnabled: true
      }
    }
  }
  dependsOn: [ fdOrigin ]
}

// ---- outputs ----

output frontDoorEndpoint string = 'https://${fdEndpoint.properties.hostName}'
output apiIngressFqdn string = apiApp.properties.configuration.ingress.fqdn
output webIngressFqdn string = webApp.properties.configuration.ingress.fqdn
output keycloakIngressFqdn string = keycloakApp.properties.configuration.ingress.fqdn
output keycloakIssuer string = 'https://${keycloakApp.properties.configuration.ingress.fqdn}/realms/controlcraft'
// Postgres output removed — Keycloak runs on H2 / Azure Files now.
// After DNS is added (`CNAME motion → ca-controlcraft-web-{env}.<env-suffix>.azurecontainerapps.io`)
// run:  az containerapp hostname add … --hostname motion.ursly.io --validation-method CNAME
// then: az containerapp hostname bind … (provisions managed cert).
// We don't bind in Bicep because the cert provisioning fails if DNS
// isn't already in place — chicken-and-egg.
output acrLoginServer string = acr.properties.loginServer
output blobAccountName string = storage.name
output cosmosEndpoint string = enableCosmos ? cosmos.properties.documentEndpoint : ''
output managedIdentityClientId string = managedIdentity.properties.clientId
output openAiEndpoint string = enableOpenAi ? openAi.properties.endpoint : ''
output keyVaultUri string = keyVault.properties.vaultUri
output workspaceId string = workspace.id

// e2e-verify-1748102400
