import * as azure from '@pulumi/azure-native';
import { azureEnv } from '../helpers';
import * as pulumi from '@pulumi/pulumi';
import { AksOutputType } from './types';
import { AppRegistration } from '../azAd';
import * as types from '../types';

export const aksRequiredOutboundPorts = ['1194', '9000', '123', '53', '80', '443'];

export const getAksConfig = async ({
  resourceName,
  resourceGroupName,
  disableLocalAccounts,
}: {
  resourceName: string;
  resourceGroupName: string;
  disableLocalAccounts?: boolean;
}): Promise<string> => {
  const aks = disableLocalAccounts
    ? await azure.containerservice.listManagedClusterUserCredentials({
        resourceName,
        resourceGroupName,
      })
    : await azure.containerservice.listManagedClusterAdminCredentials({
        resourceName,
        resourceGroupName,
      });

  return Buffer.from(aks.kubeconfigs[0].value, 'base64').toString('utf8');
};

export const getAksClusterOutput = ({
  resourceName,
  resourceGroupName,
}: {
  resourceName: pulumi.Input<string>;
  resourceGroupName: pulumi.Input<string>;
}): pulumi.Output<AksOutputType> => {
  const url = pulumi.interpolate`https://management.azure.com/subscriptions/${azureEnv.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/${resourceName}?api-version=2025-10-01`;
  //using fetch to get the aks cluster details
  return pulumi.output(url).apply(async (url) => {
    const token = await azure.authorization.getClientToken();
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch AKS cluster: ${response.statusText}`);
    }
    const data = await response.json();
    return data as AksOutputType;
  });
};

export type ArgoCDExtensionArgs = Required<types.WithGroupRolesArgs> &
  types.WithResourceGroupInputs & {
    namespace: pulumi.Input<string>;
    argoCdDomain: pulumi.Input<string>;
    workloadIdentityClientId: pulumi.Input<string>;
    aks: azure.containerservice.ManagedCluster;
    identity: AppRegistration;
    releaseTrain?: 'preview' | pulumi.Input<string>;
  };

export const createArgoCDExtension = (
  name: string,
  {
    argoCdDomain,
    namespace,
    workloadIdentityClientId,
    aks,
    identity,
    groupRoles,
    rsGroup,
    releaseTrain,
  }: ArgoCDExtensionArgs,
  opts?: pulumi.ComponentResourceOptions,
) => {
  const oidcConfig = pulumi.interpolate`
name: Azure
issuer: https://login.microsoftonline.com/${azureEnv.tenantId}/v2.0
clientID: ${identity.clientId}
azure:
  useWorkloadIdentity: true
requestedIDTokenClaims:
  groups:
    essential: true
requestedScopes:
  - openid
  - profile
  - email
  `;

  const defaultPolicy = 'role:readonly';
  const policy = `
p, role:org-admin, applications, *, */*, allow
p, role:org-admin, clusters, get, *, allow
p, role:org-admin, repositories, get, *, allow
p, role:org-admin, repositories, create, *, allow
p, role:org-admin, repositories, update, *, allow
p, role:org-admin, repositories, delete, *, allow
g, ${groupRoles.admin.objectId}, role:org-admin
g, ${groupRoles.readOnly.objectId}, role:readonly
  `;

  return new azure.kubernetesconfiguration.Extension(
    name,
    {
      autoUpgradeMinorVersion: true,
      clusterName: aks.name,
      resourceGroupName: rsGroup.resourceGroupName,
      clusterResourceName: 'managedClusters',
      clusterRp: 'Microsoft.ContainerService',
      extensionType: 'Microsoft.ArgoCD',
      releaseTrain: releaseTrain ?? 'preview',
      configurationSettings: {
        deployWithHighAvailability: 'false',
        namespaceInstall: 'true',
        'workloadIdentity.enable': 'true',
        'workloadIdentity.clientId': workloadIdentityClientId,
        'workloadIdentity.entraSSOClientId': identity.clientId,
        'config-maps.argocd-cm.data.oidc\\.config': oidcConfig,
        'config-maps.argocd-cm.data.url': pulumi.interpolate`https://${argoCdDomain}/`,
        'config-maps.argocd-rbac-cm.data.policy\\.default': defaultPolicy,
        'config-maps.argocd-rbac-cm.data.policy\\.csv': policy,
        'config-maps.argocd-cmd-params-cm.data.application\\.namespaces': namespace,
      },
    },
    { ...opts, dependsOn: [aks, identity] },
  );
};
