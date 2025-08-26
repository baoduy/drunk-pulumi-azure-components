import * as ccs from '@pulumi/azure-native/containerservice';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import { AppRegistration, RoleAssignment } from '../azAd';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import { SshGenerator } from '../common';
import { azureEnv, rsHelpers } from '../helpers';
import * as types from '../types';
import { VaultSecret } from '../vault';
import { DiskEncryptionSet } from '../vm/DiskEncryptionSet';
import * as aksHelpers from './helpers';

export interface AzKubernetesArgs
  extends CommonBaseArgs,
    types.WithEncryptionEnabler,
    types.WithGroupRolesArgs,
    types.WithUserAssignedIdentity,
    Partial<
      Pick<
        ccs.ManagedClusterArgs,
        'dnsPrefix' | 'supportPlan' | 'autoScalerProfile' | 'autoUpgradeProfile' | 'storageProfile'
      >
    > {
  sku: ccs.ManagedClusterSKUTier;
  agentPoolProfiles: pulumi.Input<
    inputs.containerservice.ManagedClusterAgentPoolProfileArgs & {
      vmSize: pulumi.Input<string>;
      vnetSubnetID: pulumi.Input<string>;
    }
  >[];
  attachToAcr?: types.ResourceInputs;
  features: {
    enablePrivateCluster: boolean;
    enablePrivateClusterPublicFQDN?: boolean;
    enableVerticalPodAutoscaler?: boolean;
    /** KEDA (Kubernetes Event-driven Autoscaling) settings for the workload auto-scaler profile. */
    enableKeda?: boolean;
    enableWorkloadIdentity?: boolean;
    enablePodIdentity?: boolean;
  };
  addonProfiles?: { enableAzureKeyVault?: boolean };
  network?: Omit<
    inputs.containerservice.ContainerServiceNetworkProfileArgs,
    'networkMode' | 'networkPolicy' | 'networkPlugin' | 'loadBalancerSku' | 'loadBalancerProfile'
  > & {
    outboundType?: ccs.OutboundType;
    loadBalancerProfile?: inputs.containerservice.ManagedClusterLoadBalancerProfileArgs & {
      backendPoolType?: ccs.BackendPoolType;
    };
    /** Link the private DNS of AKS to these VNets */
    extraPrivateDnsVnets?: types.ResourceInputs[];
    authorizedIPRanges?: pulumi.Input<string>[];
    virtualHostSubnetName?: pulumi.Input<string>;
  };
  maintenance?: Pick<ccs.MaintenanceConfigurationArgs, 'timeInWeek' | 'notAllowedTime'>;
  logWorkspace?: types.ResourceInputs & {
    defenderEnabled?: boolean;
  };
}

export class AzKubernetes extends BaseResourceComponent<AzKubernetesArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AzKubernetesArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AzKubernetes', name, args, opts);

    const app = this.createIdentity();
    const cluster = this.createCluster(app);

    this.createMaintenance(cluster);
    this.assignPermission(cluster);
    //this.addAksCredentialToVault(cluster);

    this.id = cluster.id;
    this.resourceName = cluster.name;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  private createIdentity() {
    const { rsGroup, vaultInfo, groupRoles } = this.args;

    return new AppRegistration(
      `${this.name}-identity`,
      {
        vaultInfo,
        memberof: groupRoles ? [groupRoles.readOnly] : undefined,
        roleAssignments: [
          {
            scope: rsHelpers.getRsGroupIdFrom(rsGroup),
            roleName: 'Reader',
            description: 'Allows AKS have read access to the resource group',
          },
        ],
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }

  private createUserNameAndSshKeys() {
    const { vaultInfo } = this.args;
    const userName = this.createRandomString({ type: 'string', length: 8, vaultInfo }).value.apply((v) =>
      `${this.name}-admin-${v}`.substring(0, 32),
    );
    const password = this.createPassword({ length: 50 }).value;

    const ssh = new SshGenerator(
      `${this.name}-ssh`,
      {
        vaultInfo,
        password,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );

    return { userName, sshPublicKey: ssh.publicKey };
  }

  private createDiskEncryptionSet() {
    const { rsGroup, enableEncryption, defaultUAssignedId, vaultInfo } = this.args;
    if (!enableEncryption) return undefined;
    return new DiskEncryptionSet(
      `${this.name}-disk-encryption-set`,
      {
        rsGroup,
        vaultInfo,
        defaultUAssignedId,
        encryptionType: 'EncryptionAtRestWithPlatformAndCustomerKeys',
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }

  private createCluster(app: AppRegistration) {
    const {
      rsGroup,
      vaultInfo,
      groupRoles,
      defaultUAssignedId,

      enableEncryption,
      features,
      addonProfiles,
      network,
      logWorkspace,
      sku,
      ...props
    } = this.args;
    const nodeResourceGroup = pulumi.interpolate`${rsGroup.resourceGroupName}-nodes`;
    const login = this.createUserNameAndSshKeys();
    const diskEncryptionSet = this.createDiskEncryptionSet();

    return new ccs.ManagedCluster(
      this.name,
      {
        ...props,
        ...rsGroup,
        nodeResourceGroup,
        dnsPrefix: props.dnsPrefix ?? `${azureEnv.currentEnv}-${this.name}`,

        enableRBAC: true,
        disableLocalAccounts: true,
        aadProfile: groupRoles
          ? {
              enableAzureRBAC: true,
              managed: true,
              adminGroupObjectIDs: [groupRoles.admin.objectId],
              tenantID: azureEnv.tenantId,
            }
          : undefined,

        apiServerAccessProfile: {
          authorizedIPRanges: features?.enablePrivateCluster ? undefined : network?.authorizedIPRanges ?? [],
          disableRunCommand: true,
          enablePrivateCluster: features?.enablePrivateCluster,
          //TODO: to make the life simple we enable this to allows IP DNS query from public internet.
          enablePrivateClusterPublicFQDN: features?.enablePrivateClusterPublicFQDN ?? true,
          privateDNSZone: features?.enablePrivateCluster ? 'system' : undefined,
          //privateDNSZone: privateDnsZone?.id,
        },

        addonProfiles: {
          azureKeyvaultSecretsProvider: {
            config: addonProfiles?.enableAzureKeyVault
              ? {
                  enableSecretRotation: 'true',
                }
              : undefined,
            enabled: Boolean(addonProfiles?.enableAzureKeyVault),
          },

          azurePolicy: { enabled: true },
          kubeDashboard: { enabled: false },
          httpApplicationRouting: { enabled: false },
          aciConnectorLinux: {
            enabled: Boolean(network?.virtualHostSubnetName),
            config: network?.virtualHostSubnetName ? { SubnetName: network.virtualHostSubnetName } : undefined,
          },
          // ingressApplicationGateway: {
          //   enabled: Boolean(addon.applicationGateway),
          //   config: addon.applicationGateway
          //     ? {
          //         gatewayName: `${name}-gateway`,
          //         subnetId: addon.applicationGateway.gatewaySubnetId,
          //       }
          //     : undefined,
          // },
          omsAgent: {
            enabled: Boolean(logWorkspace?.id),
            config: logWorkspace?.id
              ? {
                  logAnalyticsWorkspaceResourceID: logWorkspace.id,
                }
              : undefined,
          },
        },

        sku: {
          name: ccs.ManagedClusterSKUName.Base,
          tier: sku,
        },

        linuxProfile: {
          adminUsername: login.userName,
          ssh: { publicKeys: [{ keyData: login.sshPublicKey }] },
        },
        windowsProfile: undefined,

        workloadAutoScalerProfile: {
          verticalPodAutoscaler: {
            enabled: features?.enableVerticalPodAutoscaler || false,
          },
          keda: { enabled: features?.enableKeda || false },
        },

        //azureMonitorProfile: { metrics: { enabled } },
        //Refer here for details https://learn.microsoft.com/en-us/azure/aks/use-managed-identity
        //enablePodSecurityPolicy: true,
        diskEncryptionSetID: diskEncryptionSet?.id,

        servicePrincipalProfile: {
          clientId: app.clientId,
          secret: app.clientSecret,
        },
        oidcIssuerProfile: { enabled: Boolean(features?.enableWorkloadIdentity) },

        securityProfile: {
          defender: logWorkspace?.defenderEnabled
            ? {
                logAnalyticsWorkspaceResourceId: logWorkspace.id,
                securityMonitoring: { enabled: true },
              }
            : undefined,
          imageCleaner: { enabled: true, intervalHours: 24 },
          workloadIdentity: {
            enabled: Boolean(features?.enableWorkloadIdentity),
          },
        },

        podIdentityProfile: features?.enablePodIdentity
          ? {
              enabled: features.enablePodIdentity,
              //Not allow pod to use kublet command
              allowNetworkPluginKubenet: false,
            }
          : undefined,

        identity: {
          type: defaultUAssignedId ? ccs.ResourceIdentityType.UserAssigned : ccs.ResourceIdentityType.SystemAssigned,
          userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
        },

        networkProfile: {
          ...network,
          networkMode: ccs.NetworkMode.Transparent,
          networkPolicy: ccs.NetworkPolicy.Azure,
          networkPlugin: ccs.NetworkPlugin.Azure,

          loadBalancerSku: 'Standard',
          outboundType: network?.outboundType ?? ccs.OutboundType.UserDefinedRouting,
        },
      },
      {
        ...this.opts,
        dependsOn: app,
        parent: this,
      },
    );
  }

  private createMaintenance(aks: ccs.ManagedCluster) {
    const { rsGroup, maintenance } = this.args;
    if (!maintenance) return undefined;

    return new ccs.MaintenanceConfiguration(
      `${this.name}-MaintenanceConfiguration`,
      {
        ...rsGroup,
        ...maintenance,
        configName: 'default',
        resourceName: aks.name,
        timeInWeek: maintenance.timeInWeek ?? [
          {
            day: ccs.WeekDay.Sunday,
            hourSlots: [0, 23],
          },
        ],
      },
      { dependsOn: aks, deleteBeforeReplace: true },
    );
  }

  private assignPermission(aks: ccs.ManagedCluster) {
    const { rsGroup, attachToAcr } = this.args;
    pulumi.all([aks.identity, aks.identityProfile]).apply(([identity, identityProfile]) => {
      if (identityProfile?.kubeletIdentity) {
        this.addIdentityToRole('contributor', { principalId: identityProfile.kubeletIdentity!.objectId! });

        if (attachToAcr) {
          new RoleAssignment(
            `${this.name}-aks-acr`,
            {
              principalId: identityProfile.kubeletIdentity!.objectId!,
              principalType: 'ServicePrincipal',
              roleName: 'acr-pull',
              scope: attachToAcr.id,
            },
            { dependsOn: aks, parent: this },
          );
        }
      }
      if (identity) {
        new RoleAssignment(
          `${this.name}-aks-identity`,
          {
            principalId: identity.principalId!,
            principalType: 'ServicePrincipal',
            roleName: 'Contributor',
            scope: rsHelpers.getRsGroupIdFrom(rsGroup),
          },
          { dependsOn: aks, parent: this },
        );
      }
    });
  }

  // private addAksCredentialToVault(aks: ccs.ManagedCluster) {
  //   const { rsGroup, disableLocalAccounts, vaultInfo } = this.args;
  //   if (!vaultInfo) return undefined;
  //   return pulumi.all([aks.name, rsGroup.resourceGroupName, disableLocalAccounts]).apply(([name, rgName, disabled]) => {
  //     if (!name) return;

  //     const credential = aksHelpers.getAksConfig({
  //       resourceName: name,
  //       resourceGroupName: rgName,
  //       disableLocalAccounts: disabled,
  //     });

  //     return new VaultSecret(
  //       `${this.name}-credential`,
  //       {
  //         vaultInfo,
  //         value: credential,
  //         contentType: `AzKubernetes ${this.name} aks config`,
  //       },
  //       { dependsOn: aks, parent: this, retainOnDelete: true },
  //     );
  //   });
  // }
}
