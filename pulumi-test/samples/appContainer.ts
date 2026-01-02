import * as pulumi from '@pulumi/pulumi';
import { AppContainer } from '../src/app';

/**
 * Example: Basic Azure Container App deployment
 *
 * Prerequisites:
 * - Azure Container Apps Managed Environment (resource ID)
 * - Container image accessible from a registry
 * - Resource group and location
 */

const config = new pulumi.Config();
const managedEnvId = config.require('managedEnvironmentId');
const containerImage = config.get('containerImage') ?? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest';

// Basic container app with ingress
const basicApp = new AppContainer('basic-app', {
  rsGroup: {
    resourceGroupName: 'my-resource-group',
    location: 'East US',
  },
  managedEnvironmentId: managedEnvId,
  template: {
    containers: [
      {
        name: 'main',
        image: containerImage,
        resources: {
          cpu: 0.5,
          memory: '1Gi',
        },
        env: [
          {
            name: 'LOG_LEVEL',
            value: 'info',
          },
        ],
      },
    ],
    scale: {
      minReplicas: 1,
      maxReplicas: 5,
      rules: [
        {
          name: 'http-rule',
          http: {
            metadata: {
              concurrentRequests: '10',
            },
          },
        },
      ],
    },
  },
  configuration: {
    activeRevisionsMode: 'Single',
    ingress: {
      external: true,
      targetPort: 80,
      traffic: [
        {
          latestRevision: true,
          weight: 100,
        },
      ],
    },
  },
});

// Container app with Dapr and secrets from Key Vault
const daprApp = new AppContainer('dapr-app', {
  rsGroup: {
    resourceGroupName: 'my-resource-group',
    location: 'East US',
  },
  managedEnvironmentId: managedEnvId,
  defaultUAssignedId: {
    id: '/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/{identity}',
    clientId: '{client-id}',
    principalId: '{principal-id}',
  },
  template: {
    containers: [
      {
        name: 'api',
        image: 'myregistry.azurecr.io/api:v1',
        resources: {
          cpu: 0.25,
          memory: '0.5Gi',
        },
        env: [
          {
            name: 'DB_CONNECTION',
            secretRef: 'db-connection-string',
          },
        ],
      },
    ],
    scale: {
      minReplicas: 2,
      maxReplicas: 10,
    },
  },
  configuration: {
    dapr: {
      enabled: true,
      appId: 'my-api',
      appPort: 3000,
      appProtocol: 'http',
    },
    secrets: [
      {
        name: 'db-connection-string',
        keyVaultUrl: 'https://my-vault.vault.azure.net/secrets/db-conn',
        identity: 'system',
      },
    ],
    registries: [
      {
        server: 'myregistry.azurecr.io',
        identity: 'system',
      },
    ],
    ingress: {
      external: false,
      targetPort: 3000,
    },
  },
});

// Container app with init containers and volumes
const advancedApp = new AppContainer('advanced-app', {
  rsGroup: {
    resourceGroupName: 'my-resource-group',
    location: 'East US',
  },
  managedEnvironmentId: managedEnvId,
  template: {
    initContainers: [
      {
        name: 'setup',
        image: 'busybox:latest',
        command: ['/bin/sh'],
        args: ['-c', 'echo "Initializing..." > /shared/init.txt'],
        volumeMounts: [
          {
            volumeName: 'shared-data',
            mountPath: '/shared',
          },
        ],
      },
    ],
    containers: [
      {
        name: 'worker',
        image: 'myapp:latest',
        resources: {
          cpu: 1,
          memory: '2Gi',
        },
        volumeMounts: [
          {
            volumeName: 'shared-data',
            mountPath: '/app/data',
          },
        ],
        probes: [
          {
            type: 'Liveness',
            httpGet: {
              port: 8080,
              path: '/health',
            },
            initialDelaySeconds: 10,
            periodSeconds: 30,
          },
          {
            type: 'Readiness',
            httpGet: {
              port: 8080,
              path: '/ready',
            },
            initialDelaySeconds: 5,
            periodSeconds: 10,
          },
        ],
      },
    ],
    volumes: [
      {
        name: 'shared-data',
        storageType: 'EmptyDir',
      },
    ],
    scale: {
      minReplicas: 3,
      maxReplicas: 20,
      rules: [
        {
          name: 'cpu-scale',
          custom: {
            type: 'cpu',
            metadata: {
              type: 'Utilization',
              value: '70',
            },
          },
        },
      ],
    },
  },
  configuration: {
    activeRevisionsMode: 'Multiple',
    ingress: {
      external: true,
      targetPort: 8080,
      corsPolicy: {
        allowedOrigins: ['https://example.com'],
        allowedMethods: ['GET', 'POST'],
        allowCredentials: true,
      },
      ipSecurityRestrictions: [
        {
          action: 'Allow',
          ipAddressRange: '10.0.0.0/8',
          name: 'internal-network',
        },
      ],
    },
    maxInactiveRevisions: 5,
  },
});

export const basicAppUrl = basicApp.fqdn;
export const daprAppId = daprApp.id;
export const advancedAppRevision = advancedApp.latestRevisionName;
export const advancedAppIps = advancedApp.outboundIpAddresses;
