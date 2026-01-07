import * as ccs from '@pulumi/azure-native/containerservice';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';

import { AppRegistration, RoleAssignment } from '../azAd';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import { azureEnv, rsHelpers, zoneHelper } from '../helpers';

import { DiskEncryptionSet } from '../vm';
import { SshGenerator } from '../common';
import { getAksClusterOutput } from './helpers';
import { getPrivateRecordSetOutput } from '../vnet/helpers';

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
  extends
    CommonBaseArgs,
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
    enableKeda?: boolean;
    /** Enable workload identity and OIDC issuer for the AKS cluster */
    enableWorkloadIdentity?: boolean;
    enablePodIdentity?: boolean;
    enableAzurePolicy?: boolean;
    enableAzureKeyVault?: boolean;
  };

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
  public readonly privateDnsZone?: types.ResourceOutputs;
  public readonly privateIpAddress?: pulumi.Output<string | undefined>;
  public readonly azAppIdentity: ReturnType<AppRegistration['getOutputs']>;
  public readonly keyVaultSecretProviderIdentity?: types.IdentityOutputs;
  public readonly kubeletIdentity?: types.IdentityOutputs;
  public readonly systemIdentityId?: pulumi.Output<string>;
  public readonly oidcIssuerUrl?: pulumi.Output<string>;

  constructor(name: string, args: AzKubernetesArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AzKubernetes', name, args, opts);

    const app = this.createIdentity();
    const cluster = this.createCluster(app);
    this.createExtraAgentPoolProfiles(cluster);
    this.createMaintenance(cluster);

    const nss = this.createNameSpaces(cluster);
    this.namespaces = rsHelpers.dictReduce(nss, (n, ns) => ({
      id: ns.id,
      resourceName: ns.name.apply((n) => n!),
    }));

    const privateDns = this.getPrivateDNSZone(cluster);
    this.privateDnsZone = privateDns?.privateZone;
    this.privateIpAddress = privateDns?.privateIpAddress;

    this.azAppIdentity = app.getOutputs();
    this.id = cluster.id;
    this.resourceName = cluster.name;

    this.systemIdentityId = cluster.identity.apply((id) => id!.principalId);
    this.keyVaultSecretProviderIdentity = args.features.enableAzureKeyVault
      ? cluster.addonProfiles.apply((aa) => ({
          id: aa!.azureKeyvaultSecretsProvider.identity.resourceId!,
          clientId: aa!.azureKeyvaultSecretsProvider.identity.clientId!,
          objectId: aa!.azureKeyvaultSecretsProvider.identity.objectId!,
        }))
      : undefined;
    this.kubeletIdentity = this.getExtraAksOutputs(cluster);
    this.oidcIssuerUrl = args.features?.enableWorkloadIdentity
      ? cluster.oidcIssuerProfile.apply((o) => o?.issuerURL!)
      : undefined;

    this.assignPermission(cluster);
    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
      namespaces: this.namespaces,
      privateDnsZone: this.privateDnsZone,
      privateIpAddress: this.privateIpAddress,
      azAppIdentity: this.azAppIdentity,
      keyVaultSecretProviderIdentity: this.keyVaultSecretProviderIdentity,
      kubeletIdentity: this.kubeletIdentity,
      systemIdentityId: this.systemIdentityId,
      oidcIssuerUrl: this.oidcIssuerUrl,
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
    const { rsGroup, enableEncryption, diskEncryptionSet, groupRoles, defaultUAssignedId, vaultInfo } = this.args;
    if (!enableEncryption) return undefined;
    if (diskEncryptionSet) return diskEncryptionSet;

    return new DiskEncryptionSet(
      `${this.name}-disk-encryption-set`,
      {
        rsGroup,
        vaultInfo,
        defaultUAssignedId,
        groupRoles,
        encryptionType: 'EncryptionAtRestWithPlatformAndCustomerKeys',
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    ).getOutputs();
  }

  private createCluster(appID: AppRegistration) {
    const {
      rsGroup,
      vaultInfo,
      groupRoles,
      defaultUAssignedId,
      enableEncryption,
      nodeResourceGroup,
      features,
      network,
      logWorkspace,
      sku,
      autoScalerProfile,
      extraAgentPoolProfiles,
      agentPoolProfiles,
      attachToAcr,
      maintenance,
      namespaces,
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
            config: features?.enableAzureKeyVault
              ? {
                  enableSecretRotation: 'true',
                }
              : undefined,
            enabled: Boolean(features?.enableAzureKeyVault),
          },

          azurePolicy: { enabled: features?.enableAzurePolicy || false },
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
          type: ccs.ResourceIdentityType.SystemAssigned,
          //type: defaultUAssignedId ? ccs.ResourceIdentityType.UserAssigned : ccs.ResourceIdentityType.SystemAssigned,
          //userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
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
          //networkMode: ccs.NetworkMode.Transparent,
          networkPlugin: ccs.NetworkPlugin.Azure,
          networkPolicy: network?.networkPolicy ?? ccs.NetworkPolicy.Cilium,
          networkDataplane: network?.networkPolicy ?? ccs.NetworkDataplane.Cilium,
          networkPluginMode: ccs.NetworkPluginMode.Overlay,

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
          clientId: appID.clientId,
          secret: appID.clientSecret,
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
          keda: { enabled: features?.enableKeda || false },
        },

        //azureMonitorProfile: { metrics: { enabled } },
        //Refer here for details https://learn.microsoft.com/en-us/azure/aks/use-managed-identity
        //enablePodSecurityPolicy: true,
      },
      {
        ...this.opts,
        dependsOn: appID,
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

  private getExtraAksOutputs(aks: ccs.ManagedCluster) {
    const { rsGroup } = this.args;
    const aksInfo = getAksClusterOutput({ resourceGroupName: rsGroup.resourceGroupName, resourceName: aks.name });
    return aksInfo.properties.identityProfile.apply((p) => ({
      id: p!.kubeletidentity.resourceId!,
      clientId: p!.kubeletidentity.clientId!,
      objectId: p!.kubeletidentity.objectId!,
    }));
  }

  private assignPermission(aks: ccs.ManagedCluster) {
    const { rsGroup, attachToAcr } = this.args;

    if (attachToAcr && this.kubeletIdentity) {
      pulumi.output(this.kubeletIdentity!).apply((p) => {
        new RoleAssignment(
          `${this.name}-aks-acr-pull`,
          {
            principalId: p!.objectId!,
            principalType: 'ServicePrincipal',
            roleName: 'AcrPull',
            scope: attachToAcr.id,
          },
          { dependsOn: aks, deletedWith: aks, parent: this },
        );
        new RoleAssignment(
          `${this.name}-aks-acr-read`,
          {
            principalId: p!.objectId!,
            principalType: 'ServicePrincipal',
            roleName: 'Container Registry Repository Reader',
            scope: attachToAcr.id,
          },
          { dependsOn: aks, deletedWith: aks, parent: this },
        );
      });
    }

    //Allows AKS to have Contributor role on the resource group
    aks.identity.apply(
      (id) =>
        new RoleAssignment(
          `${this.name}-aks-identity`,
          {
            principalId: id!.principalId!,
            principalType: 'ServicePrincipal',
            roleName: 'Contributor',
            scope: rsHelpers.getRsGroupIdFrom(rsGroup),
          },
          { dependsOn: aks, deletedWith: aks, parent: this },
        ),
    );
  }

  private getPrivateDNSZone(aks: ccs.ManagedCluster) {
    const { features } = this.args;
    if (!features.enablePrivateCluster) return undefined;

    const rsGroup = aks.nodeResourceGroup;
    const zoneNames = aks.privateFQDN.apply((fqdn) => {
      const p = fqdn.split('.');
      return { privateClusterName: p[0], privateZoneName: p.slice(1).join('.') };
    });

    const id = pulumi.interpolate`/subscriptions/${azureEnv.subscriptionId}/resourceGroups/${rsGroup}/providers/Microsoft.Network/privateDnsZones/${zoneNames.privateZoneName}`;
    //Get private IpAddress from Private DNS Zone
    const rs = getPrivateRecordSetOutput({
      privateZoneName: zoneNames.privateZoneName,
      resourceGroupName: rsGroup.apply((g) => g!),
      relativeRecordSetName: zoneNames.privateClusterName,
      recordType: 'A',
    });

    return {
      privateZone: { id, resourceName: zoneNames.privateZoneName },
      privateIpAddress: rs!.aRecords!.apply((ars) => (ars && ars.length > 0 ? ars[0].ipv4Address : undefined)),
    };
  }

  private getDefaultAutoUpgradeWindow(): AutoUpgradeScheduleArgs {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startDate = tomorrow.toISOString().split('T')[0];
    return {
      schedule: {
        weekly: {
          dayOfWeek: 'Sunday',
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
