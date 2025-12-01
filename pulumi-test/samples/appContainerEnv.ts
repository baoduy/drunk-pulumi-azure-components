import * as pulumi from '@pulumi/pulumi';
import { AppContainerEnv, AppContainer } from '../src';

const config = new pulumi.Config();

// Create a Container Apps Managed Environment
const environment = new AppContainerEnv('sample-env', {
  rsGroup: {
    resourceGroupName: 'sample-rg',
    location: 'eastus',
  },
  // Optional: Use Log Analytics for monitoring
  // logAnalyticsWorkspace: {
  //   id: workspace.id,
  //   resourceName: workspace.name,
  // },
  zoneRedundant: true,
});

// Basic container app
const basicApp = new AppContainer('basic-app', {
  rsGroup: {
    resourceGroupName: 'sample-rg',
    location: 'eastus',
  },
  managedEnvironmentId: environment.id,
  template: {
    containers: [
      {
        name: 'main',
        image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest',
        resources: {
          cpu: 0.25,
          memory: '0.5Gi',
        },
      },
    ],
    scale: {
      minReplicas: 0,
      maxReplicas: 5,
    },
  },
  configuration: {
    ingress: {
      external: true,
      targetPort: 80,
    },
  },
});

// Advanced container app with VNet-integrated environment
const vnetEnvironment = new AppContainerEnv('vnet-env', {
  rsGroup: {
    resourceGroupName: 'sample-rg',
    location: 'eastus',
  },
  vnetConfiguration: {
    infrastructureSubnet: {
      id: config.require('subnetId'), // Your subnet ID
    },
    internal: true,
    platformReservedCidr: '10.1.0.0/23',
    platformReservedDnsIP: '10.1.0.10',
  },
  zoneRedundant: true,
});

const advancedApp = new AppContainer('advanced-app', {
  rsGroup: {
    resourceGroupName: 'sample-rg',
    location: 'eastus',
  },
  managedEnvironmentId: vnetEnvironment.id,
  template: {
    containers: [
      {
        name: 'api',
        image: 'myregistry.azurecr.io/api:v1',
        env: [
          {
            name: 'DATABASE_URL',
            secretRef: 'db-connection',
          },
        ],
        resources: {
          cpu: 0.5,
          memory: '1Gi',
        },
      },
    ],
    scale: {
      minReplicas: 1,
      maxReplicas: 10,
      rules: [
        {
          name: 'http-rule',
          http: {
            metadata: {
              concurrentRequests: '100',
            },
          },
        },
      ],
    },
  },
  configuration: {
    activeRevisionsMode: 'Multiple',
    ingress: {
      external: false, // Internal only
      targetPort: 8080,
      traffic: [
        {
          latestRevision: true,
          weight: 100,
        },
      ],
    },
    secrets: [
      {
        name: 'db-connection',
        value: config.requireSecret('dbConnectionString'),
      },
    ],
    dapr: {
      enabled: true,
      appId: 'advanced-app',
      appPort: 8080,
    },
  },
});

export const outputs = {
  environment: environment.getOutputs(),
  vnetEnvironment: vnetEnvironment.getOutputs(),
  basicApp: basicApp.getOutputs(),
  advancedApp: advancedApp.getOutputs(),
};
