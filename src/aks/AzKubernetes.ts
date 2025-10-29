import * as ccs from '@pulumi/azure-native/containerservice';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';

import { AppRegistration, RoleAssignment } from '../azAd';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import { azureEnv, rsHelpers, zoneHelper } from '../helpers';

import { DiskEncryptionSet } from '../vm/DiskEncryptionSet';
import { SshGenerator } from '../common';

type AgentPoolProfile = inputs.containerservice.ManagedClusterAgentPoolProfileArgs & {
  vmSize: pulumi.Input<string>;
  vnetSubnetID: pulumi.Input<string>;
  enableEncryptionAtHost: pulumi.Input<boolean>;
  osDiskSizeGB: pulumi.Input<number>;
} & { name: string };

type LegacyMaintenanceArgs = Pick<ccs.MaintenanceConfigurationArgs, 'timeInWeek' | 'notAllowedTime'>;

type AutoUpgradeScheduleArgs = inputs.containerservice.MaintenanceWindowArgs & {
  configName?: pulumi.Input<string>;
};

type MaintenanceArgs =
  | LegacyMaintenanceArgs
  | { default?: LegacyMaintenanceArgs; autoUpgrade?: AutoUpgradeScheduleArgs; nodeOS?: AutoUpgradeScheduleArgs };

const isLegacyMaintenanceArgs = (maintenance: MaintenanceArgs | undefined): maintenance is LegacyMaintenanceArgs => {
  if (!maintenance) return false;
  return 'timeInWeek' in maintenance || 'notAllowedTime' in maintenance;
};

const getDefaultMaintenanceArgs = (maintenance: MaintenanceArgs | undefined): LegacyMaintenanceArgs | undefined => {
  if (!maintenance) return undefined;
  if (isLegacyMaintenanceArgs(maintenance)) return maintenance;
  return maintenance.default;
};

const getAutoUpgradeWindow = (maintenance: MaintenanceArgs | undefined): AutoUpgradeScheduleArgs | undefined => {
  if (!maintenance || isLegacyMaintenanceArgs(maintenance)) return undefined;
  return maintenance.autoUpgrade;
};

const getNodeOSWindow = (maintenance: MaintenanceArgs | undefined): AutoUpgradeScheduleArgs | undefined => {
  if (!maintenance || isLegacyMaintenanceArgs(maintenance)) return undefined;
  return maintenance.nodeOS;
};

export interface AzKubernetesArgs
  extends CommonBaseArgs,
    types.WithEncryptionEnabler,
    types.WithGroupRolesArgs,
    types.WithUserAssignedIdentity,
    types.WithDiskEncryptSet,
    Partial<
      Pick<
        ccs.ManagedClusterArgs,
        'dnsPrefix' | 'supportPlan' | 'autoScalerProfile' | 'autoUpgradeProfile' | 'storageProfile'
      >
    > {
  sku: ccs.ManagedClusterSKUTier;
  nodeResourceGroup?: pulumi.Input<string>;
  namespaces?: Record<string, ccs.NamespaceArgs['properties']>;
  /** This only allows when cluster creating. For additional agent pool after cluster created please use extraAgentPools */
  agentPoolProfiles: AgentPoolProfile[];
  extraAgentPoolProfiles?: AgentPoolProfile[];
  attachToAcr?: types.ResourceInputs;
  features: {
    enablePrivateCluster: boolean;
    enablePrivateClusterPublicFQDN?: boolean;
    enableVerticalPodAutoscaler?: boolean;
    /** KEDA (Kubernetes Event-driven Autoscaling) settings for the workload auto-scaler profile. */
    //enableKeda?: boolean;
    enableWorkloadIdentity?: boolean;
    enablePodIdentity?: boolean;
  };
  addonProfiles?: { enableAzureKeyVault?: boolean };
  network?: Omit<
    inputs.containerservice.ContainerServiceNetworkProfileArgs,
    'networkMode' | 'networkPolicy' | 'networkPlugin' | 'loadBalancerSku' | 'loadBalancerProfile'
  > & {
    networkPolicy?: ccs.NetworkPolicy;
    outboundType?: ccs.OutboundType;
    loadBalancerProfile?: inputs.containerservice.ManagedClusterLoadBalancerProfileArgs & {
      backendPoolType?: ccs.BackendPoolType;
    };
    /** Link the private DNS of AKS to these VNets */
    extraPrivateDnsVnets?: types.ResourceInputs[];
    authorizedIPRanges?: pulumi.Input<string>[];
    virtualHostSubnetName?: pulumi.Input<string>;
  };
  maintenance?: MaintenanceArgs;
  logWorkspace?: types.ResourceInputs & {
    defenderEnabled?: boolean;
  };
}

export class AzKubernetes extends BaseResourceComponent<AzKubernetesArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;
  public readonly namespaces: Record<string, types.ResourceOutputs>;
  public readonly privateDnsZone: types.ResourceOutputs | undefined;

  constructor(name: string, args: AzKubernetesArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AzKubernetes', name, args, opts);

    const app = this.createIdentity();
    const cluster = this.createCluster(app);
    this.createExtraAgentPoolProfiles(cluster);
    this.createMaintenance(cluster);
    this.assignPermission(cluster);
    const nss = this.createNameSpaces(cluster);
    this.privateDnsZone = this.getPrivateDNSZone(cluster);

    this.id = cluster.id;
    this.resourceName = cluster.name;

    this.namespaces = rsHelpers.dictReduce(nss, (n, ns) => ({
      id: ns.id,
      resourceName: ns.name.apply((n) => n!),
    }));

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
      namespaces: this.namespaces,
      privateDnsZone: this.privateDnsZone,
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
    const { rsGroup, enableEncryption, diskEncryptionSet, defaultUAssignedId, vaultInfo } = this.args;
    if (!enableEncryption) return undefined;
    if (diskEncryptionSet) return diskEncryptionSet;

    return new DiskEncryptionSet(
      `${this.name}-disk-encryption-set`,
      {
        rsGroup,
        vaultInfo,
        defaultUAssignedId,
        encryptionType: 'EncryptionAtRestWithPlatformAndCustomerKeys',
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    ).getOutputs();
  }

  private createCluster(app: AppRegistration) {
    const {
      rsGroup,
      vaultInfo,
      groupRoles,
      defaultUAssignedId,
      enableEncryption,
      nodeResourceGroup,
      features,
      addonProfiles,
      network,
      logWorkspace,
      sku,
      autoScalerProfile,
      extraAgentPoolProfiles,
      agentPoolProfiles,
      ...props
    } = this.args;
    const nodeRg = nodeResourceGroup ?? pulumi.interpolate`${rsGroup.resourceGroupName}-nodes`;
    const login = this.createUserNameAndSshKeys();
    const diskEncryptionSet = this.createDiskEncryptionSet();

    // Add default zones for PRD environment to agent pools
    const poolsWithZones = agentPoolProfiles.map((pool) => ({
      ...pool,
      availabilityZones: zoneHelper.getDefaultZones(pool.availabilityZones),
    }));

    return new ccs.ManagedCluster(
      this.name,
      {
        ...props,
        ...rsGroup,
        agentPoolProfiles: poolsWithZones,
        aadProfile: groupRoles
          ? {
              enableAzureRBAC: true,
              managed: true,
              adminGroupObjectIDs: [groupRoles.admin.objectId],
              tenantID: azureEnv.tenantId,
            }
          : undefined,

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

        apiServerAccessProfile: {
          authorizedIPRanges: features?.enablePrivateCluster ? undefined : (network?.authorizedIPRanges ?? []),
          disableRunCommand: true,
          enablePrivateCluster: features?.enablePrivateCluster,
          //TODO: to make the life simple we enable this to allows IP DNS query from public internet.
          enablePrivateClusterPublicFQDN: features?.enablePrivateClusterPublicFQDN ?? true,
          privateDNSZone: features?.enablePrivateCluster ? 'system' : undefined,
          //privateDNSZone: privateDnsZone?.id,
        },

        autoScalerProfile: autoScalerProfile ?? {
          balanceSimilarNodeGroups: 'false',
          expander: 'random',
          maxEmptyBulkDelete: '10',
          maxGracefulTerminationSec: '600',
          maxNodeProvisionTime: '15m',
          maxTotalUnreadyPercentage: '45',
          newPodScaleUpDelay: '0s',
          okTotalUnreadyCount: '3',
          scaleDownDelayAfterAdd: '10m',
          scaleDownDelayAfterDelete: '10s',
          scaleDownDelayAfterFailure: '3m',
          scaleDownUnneededTime: '10m',
          scaleDownUnreadyTime: '20m',
          scaleDownUtilizationThreshold: '0.5',
          scanInterval: '10s',
          skipNodesWithLocalStorage: 'false',
          skipNodesWithSystemPods: 'true',
        },

        autoUpgradeProfile: {
          nodeOSUpgradeChannel: ccs.NodeOSUpgradeChannel.NodeImage,
          upgradeChannel: ccs.UpgradeChannel.Stable,
        },

        disableLocalAccounts: true,
        diskEncryptionSetID: diskEncryptionSet?.id,
        dnsPrefix: props.dnsPrefix ?? `${azureEnv.currentEnv}-${this.name}`,
        enableRBAC: true,

        identity: {
          type: defaultUAssignedId ? ccs.ResourceIdentityType.UserAssigned : ccs.ResourceIdentityType.SystemAssigned,
          userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
        },

        // identityProfile: defaultUAssignedId
        //   ? pulumi.output(defaultUAssignedId).apply((uID) => ({ [uID.id]: uID }))
        //   : undefined,

        linuxProfile: {
          adminUsername: login.userName,
          ssh: { publicKeys: [{ keyData: login.sshPublicKey }] },
        },

        networkProfile: {
          ...network,
          networkMode: ccs.NetworkMode.Transparent,
          networkPolicy: network?.networkPolicy ?? ccs.NetworkPolicy.Cilium,
          networkPlugin: ccs.NetworkPlugin.Azure,

          loadBalancerSku: 'Standard',
          outboundType: network?.outboundType ?? ccs.OutboundType.UserDefinedRouting,
        },

        nodeResourceGroup: nodeRg,
        oidcIssuerProfile: { enabled: Boolean(features?.enableWorkloadIdentity) },
        podIdentityProfile: features?.enablePodIdentity
          ? {
              enabled: features.enablePodIdentity,
              //Not allow pod to use kublet command
              allowNetworkPluginKubenet: false,
            }
          : undefined,

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

        servicePrincipalProfile: {
          clientId: app.clientId,
          secret: app.clientSecret,
        },

        sku: {
          name: ccs.ManagedClusterSKUName.Base,
          tier: sku,
        },

        windowsProfile: undefined,
        workloadAutoScalerProfile: {
          verticalPodAutoscaler: {
            enabled: features?.enableVerticalPodAutoscaler || false,
          },
          keda: { enabled: true },
        },

        //azureMonitorProfile: { metrics: { enabled } },
        //Refer here for details https://learn.microsoft.com/en-us/azure/aks/use-managed-identity
        //enablePodSecurityPolicy: true,
      },
      {
        ...this.opts,
        dependsOn: app,
        parent: this,
      },
    );
  }

  private createExtraAgentPoolProfiles(aks: ccs.ManagedCluster) {
    const { rsGroup, extraAgentPoolProfiles } = this.args;
    if (!extraAgentPoolProfiles || extraAgentPoolProfiles.length === 0) return;

    return extraAgentPoolProfiles.map(
      (profile) =>
        new ccs.AgentPool(
          `${this.name}-${profile.name}`,
          {
            ...rsGroup,
            ...profile,
            availabilityZones: zoneHelper.getDefaultZones(profile.availabilityZones),
            resourceName: aks.name,
            agentPoolName: profile.name,
          },
          { dependsOn: aks, deletedWith: aks, parent: this },
        ),
    );
  }

  private createNameSpaces(aks: ccs.ManagedCluster) {
    const { rsGroup, namespaces } = this.args;
    if (!namespaces) return {} as Record<string, ccs.Namespace>;

    return rsHelpers.dictReduce(
      namespaces,
      (n, props) =>
        new ccs.Namespace(
          `${this.name}-ns-${n}`,
          {
            ...rsGroup,
            resourceName: aks.name,
            namespaceName: n,
            properties: props,
          },
          { dependsOn: aks, parent: this, retainOnDelete: true },
        ),
    );
  }

  private createMaintenance(aks: ccs.ManagedCluster) {
    const { rsGroup, maintenance } = this.args;
    const defaultMaintenanceArgs = getDefaultMaintenanceArgs(maintenance);
    const autoUpgradeWindow = getAutoUpgradeWindow(maintenance) ?? this.getDefaultAutoUpgradeWindow();
    const nodeOSWindow = getNodeOSWindow(maintenance) ?? this.getDefaultAutoUpgradeWindow();

    const defaultMaintenance = new ccs.MaintenanceConfiguration(
      `${this.name}-MaintenanceConfiguration`,
      {
        ...rsGroup,
        configName: 'default',
        resourceName: aks.name,
        timeInWeek: defaultMaintenanceArgs?.timeInWeek ?? [
          {
            day: ccs.WeekDay.Sunday,
            hourSlots: [0, 23],
          },
        ],
        notAllowedTime: defaultMaintenanceArgs?.notAllowedTime,
      },
      { dependsOn: aks, deletedWith: aks, deleteBeforeReplace: true, parent: this },
    );

    const autoUpgradeMaintenance = new ccs.MaintenanceConfiguration(
      `${this.name}-AutoUpgradeSchedule`,
      {
        ...rsGroup,
        configName: autoUpgradeWindow.configName ?? 'aksManagedAutoUpgradeSchedule',
        resourceName: aks.name,
        maintenanceWindow: autoUpgradeWindow,
      },
      { dependsOn: aks, deletedWith: aks, deleteBeforeReplace: true, parent: this },
    );

    const nodeOSMaintenance = new ccs.MaintenanceConfiguration(
      `${this.name}-NodeOSUpgradeSchedule`,
      {
        ...rsGroup,
        configName: nodeOSWindow.configName ?? 'aksManagedNodeOSUpgradeSchedule',
        resourceName: aks.name,
        maintenanceWindow: nodeOSWindow,
      },
      { dependsOn: aks, deletedWith: aks, deleteBeforeReplace: true, parent: this },
    );


    return { default: defaultMaintenance, autoUpgrade: autoUpgradeMaintenance, nodeOS: nodeOSMaintenance };
  }

  private assignPermission(aks: ccs.ManagedCluster) {
    const { rsGroup, attachToAcr } = this.args;
    pulumi
      .all([aks.identity, aks.identityProfile, aks.addonProfiles, attachToAcr])
      .apply(([identity, identityProfile, addon, acr]) => {
        //User Assigned Identity
        //console.log(Object.values(identityProfile!));
        if (identityProfile?.kubeletidentity) {
          this.addIdentityToRole('contributor', { principalId: identityProfile.kubeletidentity!.objectId! });

          if (acr) {
            new RoleAssignment(
              `${this.name}-aks-acr`,
              {
                principalId: identityProfile.kubeletidentity!.objectId!,
                principalType: 'ServicePrincipal',
                roleName: 'AcrPull',
                scope: acr.id,
              },
              { dependsOn: aks, deletedWith: aks, parent: this },
            );
          }
        }

        //System Managed Identity
        if (identity?.principalId) {
          new RoleAssignment(
            `${this.name}-aks-identity`,
            {
              principalId: identity.principalId!,
              principalType: 'ServicePrincipal',
              roleName: 'Contributor',
              scope: rsHelpers.getRsGroupIdFrom(rsGroup),
            },
            { dependsOn: aks, deletedWith: aks, parent: this },
          );
        }

        //addon
        if (addon?.azureKeyvaultSecretsProvider?.identity) {
          this.addIdentityToRole('readOnly', {
            principalId: addon.azureKeyvaultSecretsProvider.identity!.objectId!,
          });
        }
      });
  }

  private getPrivateDNSZone(aks: ccs.ManagedCluster): types.ResourceOutputs | undefined {
    const { features } = this.args;
    if (!features.enablePrivateCluster) return undefined;

    const rsGroup = aks.nodeResourceGroup;
    const zoneName = aks.privateFQDN.apply((fqdn) => {
      if (!fqdn) return fqdn!;
      const firstDot = fqdn.indexOf('.');
      return firstDot >= 0 ? fqdn.substring(firstDot + 1) : fqdn;
    });

    const id = pulumi.interpolate`/subscriptions/${azureEnv.subscriptionId}/resourceGroups/${rsGroup}/providers/Microsoft.Network/privateDnsZones/${zoneName}`;
    return { id, resourceName: zoneName };
  }

  private getDefaultAutoUpgradeWindow(): AutoUpgradeScheduleArgs {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startDate = tomorrow.toISOString().split('T')[0];
    return {
      schedule: {
        weekly: {
          dayOfWeek: "Sunday",
          intervalWeeks: 1,
        },
      },
      durationHours: 4,
      utcOffset: '+08:00',
      startTime: '00:00',
      startDate,
    };
  }
}
