import * as types from '../../types';

export type RsRoleDefinitionType = Record<types.GroupRoleTypes, string[]>;

const rsRoles = {
  rsGroup: {
    admin: ['Owner'],
    contributor: ['Contributor'],
    readOnly: ['Reader'],
  },
  aks: {
    readOnly: ['Azure Kubernetes Service RBAC Reader', 'Azure Kubernetes Service Cluster User Role'],
    contributor: ['Azure Kubernetes Service RBAC Writer', 'Azure Kubernetes Service Cluster User Role'],
    admin: ['Azure Kubernetes Service RBAC Cluster Admin'],
  },
  iotHub: {
    readOnly: ['IoT Hub Data Reader'],
    contributor: ['IoT Hub Data Contributor'],
    admin: ['IoT Hub Registry Contributor', 'IoT Hub Twin Contributor'],
  },
  keyVault: {
    readOnly: [
      'Key Vault Crypto Service Encryption User',
      'Key Vault Crypto Service Release User',
      'Key Vault Secrets User',
      'Key Vault Crypto User',
      'Key Vault Certificate User',
      'Key Vault Reader',
    ],
    contributor: [
      'Key Vault Certificates Officer',
      'Key Vault Crypto Officer',
      'Key Vault Secrets Officer',
      'Key Vault Contributor',
    ],
    admin: ['Key Vault Administrator', 'Key Vault Data Access Administrator'],
  },
  storage: {
    readOnly: [
      'Storage Blob Data Reader',
      'Storage File Data SMB Share Reader',
      'Storage Queue Data Reader',
      'Storage Table Data Reader',
    ],
    contributor: [
      'Storage Account Backup Contributor',
      'Storage Account Contributor',
      'Storage Account Encryption Scope Contributor Role',
      'Storage Blob Data Contributor',
      'Storage File Data Privileged Reader',
      'Storage File Data SMB Share Contributor',
      'Storage File Data SMB Share Elevated Contributor',
      'Storage Queue Data Contributor',
      'Storage Queue Data Message Processor',
      'Storage Queue Data Message Sender',
      'Storage Table Data Contributor',
    ],
    admin: [
      'Storage Account Key Operator Service Role',
      'Storage Blob Data Owner',
      'Storage File Data Privileged Contributor',
    ],
  },
  containerRegistry: {
    readOnly: [
      //'ACR Registry Catalog Lister',
      'ACR Repository Reader',
      'AcrQuarantineReader',
      //'AcrPull',
    ],
    contributor: [
      'AcrImageSigner',
      'AcrPull',
      'AcrPush',

      //'ACR Repository Contributor',
      //'ACR Repository Writer',
      //'AcrQuarantineWriter',
    ],
    admin: ['AcrDelete'],
  },
  appConfig: {
    readOnly: ['App Configuration Data Reader'],
    contributor: ['App Configuration Data Owner'],
    admin: [],
  },
  serviceBus: {
    readOnly: ['Azure Service Bus Data Receiver'],
    contributor: ['Azure Service Bus Data Sender'],
    admin: ['Azure Service Bus Data Owner'],
  },
  signalR: {
    readOnly: ['SignalR REST API Reader'],
    contributor: ['SignalR App Server'],
    admin: ['SignalR REST API Owner'],
  },
  redis: {
    readOnly: [],
    contributor: ['Redis Cache Contributor'],
    admin: [],
  },
};
export type RsRoleDefinitionObject = {
  [K in keyof typeof rsRoles]: RsRoleDefinitionType & {
    getReadOnly: () => RsRoleDefinitionType;
    getContributor: () => RsRoleDefinitionType;
  };
};

function getRsRoleDefinitions(): RsRoleDefinitionObject {
  return Object.entries(rsRoles).reduce((acc, [key, roles]) => {
    acc[key as keyof typeof rsRoles] = {
      ...roles,
      getReadOnly: () => ({
        admin: [],
        contributor: [],
        readOnly: roles.readOnly,
      }),
      getContributor: () => ({
        admin: [],
        contributor: roles.contributor,
        readOnly: roles.readOnly,
      }),
    };
    return acc;
  }, {} as RsRoleDefinitionObject);
}

export const rsRoleDefinitions = getRsRoleDefinitions();
