export type AksOutputType = {
  readonly id: string;
  readonly location: string;
  readonly name: string;
  readonly tags: Tags;
  readonly type: string;
  readonly kind: string;
  readonly properties: AksProperties;
  readonly identity: AksTypeIdentity;
  readonly sku: Sku;
  readonly eTag: string;
};

export type AksTypeIdentity = {
  readonly type: string;
  readonly principalId: string;
  readonly tenantId: string;
};

export type AksProperties = {
  readonly provisioningState: string;
  readonly powerState: PowerState;
  readonly kubernetesVersion: string;
  readonly currentKubernetesVersion: string;
  readonly dnsPrefix: string;
  readonly fqdn: string;
  readonly azurePortalFQDN: string;
  readonly privateFQDN: string;
  readonly agentPoolProfiles: AgentPoolProfile[];
  readonly linuxProfile: LinuxProfile;
  readonly windowsProfile: WindowsProfile;
  readonly servicePrincipalProfile: ServicePrincipalProfile;
  readonly addonProfiles: AddonProfiles;
  readonly nodeResourceGroup: string;
  readonly enableRBAC: boolean;
  readonly supportPlan: string;
  readonly networkProfile: NetworkProfile;
  readonly aadProfile: AadProfile;
  readonly maxAgentPools: number;
  readonly privateLinkResources: PrivateLinkResource[];
  readonly apiServerAccessProfile: APIServerAccessProfile;
  readonly diskEncryptionSetID: string;
  readonly identityProfile: IdentityProfile;
  readonly autoScalerProfile: AutoScalerProfile;
  readonly autoUpgradeProfile: AutoUpgradeProfile;
  readonly disableLocalAccounts: boolean;
  readonly securityProfile: PropertiesSecurityProfile;
  readonly storageProfile: StorageProfile;
  readonly oidcIssuerProfile: OidcIssuerProfile;
  readonly workloadAutoScalerProfile: WorkloadAutoScalerProfile;
  readonly azureMonitorProfile: AzureMonitorProfile;
  readonly resourceUID: string;
  readonly metricsProfile: MetricsProfile;
  readonly nodeProvisioningProfile: NodeProvisioningProfile;
  readonly bootstrapProfile: BootstrapProfile;
};

export type AadProfile = {
  readonly managed: boolean;
  readonly adminGroupObjectIDs: string[];
  readonly adminUsers: null;
  readonly enableAzureRBAC: boolean;
  readonly tenantID: string;
};

export type AddonProfiles = {
  readonly aciConnectorLinux: AciConnectorLinux;
  readonly azureKeyvaultSecretsProvider: AzureKeyvaultSecretsProvider;
  readonly azurePolicy: AciConnectorLinux;
  readonly httpApplicationRouting: AciConnectorLinux;
  readonly kubeDashboard: AciConnectorLinux;
  readonly omsAgent: AciConnectorLinux;
};

export type AciConnectorLinux = {
  readonly enabled: boolean;
  readonly config: AzureMonitorProfile | null;
};

export type AzureMonitorProfile = {};

export type AzureKeyvaultSecretsProvider = {
  readonly enabled: boolean;
  readonly config: Config;
  readonly identity: KubeletidentityClass;
};

export type Config = {
  readonly enableSecretRotation: string;
};

export type KubeletidentityClass = {
  readonly resourceId: string;
  readonly clientId: string;
  readonly objectId: string;
};

export type AgentPoolProfile = {
  readonly name: string;
  readonly count: number;
  readonly vmSize: string;
  readonly osDiskSizeGB: number;
  readonly osDiskType: string;
  readonly kubeletDiskType: string;
  readonly vnetSubnetID: string;
  readonly maxPods: number;
  readonly type: string;
  readonly availabilityZones: string[];
  readonly maxCount: number;
  readonly minCount: number;
  readonly enableAutoScaling: boolean;
  readonly scaleDownMode: string;
  readonly provisioningState: string;
  readonly powerState: PowerState;
  readonly orchestratorVersion: string;
  readonly currentOrchestratorVersion: string;
  readonly enableNodePublicIP: boolean;
  readonly mode: string;
  readonly enableEncryptionAtHost: boolean;
  readonly enableUltraSSD: boolean;
  readonly osType: string;
  readonly osSKU: string;
  readonly nodeImageVersion: string;
  readonly upgradeSettings: UpgradeSettings;
  readonly enableFIPS: boolean;
  readonly securityProfile: AgentPoolProfileSecurityProfile;
  readonly eTag: string;
};

export type PowerState = {
  readonly code: string;
};

export type AgentPoolProfileSecurityProfile = {
  readonly enableVTPM: boolean;
  readonly enableSecureBoot: boolean;
};

export type UpgradeSettings = {
  readonly maxSurge: string;
  readonly maxUnavailable: string;
};

export type APIServerAccessProfile = {
  readonly enablePrivateCluster: boolean;
  readonly privateDNSZone: string;
  readonly enablePrivateClusterPublicFQDN: boolean;
  readonly disableRunCommand: boolean;
};

export type AutoScalerProfile = {
  readonly 'balance-similar-node-groups': string;
  readonly 'daemonset-eviction-for-empty-nodes': boolean;
  readonly 'daemonset-eviction-for-occupied-nodes': boolean;
  readonly expander: string;
  readonly 'ignore-daemonsets-utilization': boolean;
  readonly 'max-empty-bulk-delete': string;
  readonly 'max-graceful-termination-sec': string;
  readonly 'max-node-provision-time': string;
  readonly 'max-total-unready-percentage': string;
  readonly 'new-pod-scale-up-delay': string;
  readonly 'ok-total-unready-count': string;
  readonly 'scale-down-delay-after-add': string;
  readonly 'scale-down-delay-after-delete': string;
  readonly 'scale-down-delay-after-failure': string;
  readonly 'scale-down-unneeded-time': string;
  readonly 'scale-down-unready-time': string;
  readonly 'scale-down-utilization-threshold': string;
  readonly 'scan-interval': string;
  readonly 'skip-nodes-with-local-storage': string;
  readonly 'skip-nodes-with-system-pods': string;
};

export type AutoUpgradeProfile = {
  readonly upgradeChannel: string;
  readonly nodeOSUpgradeChannel: string;
};

export type BootstrapProfile = {
  readonly artifactSource: string;
};

export type IdentityProfile = {
  readonly kubeletidentity: KubeletidentityClass;
};

export type LinuxProfile = {
  readonly adminUsername: string;
  readonly ssh: SSH;
};

export type SSH = {
  readonly publicKeys: PublicKey[];
};

export type PublicKey = {
  readonly keyData: string;
};

export type MetricsProfile = {
  readonly costAnalysis: OidcIssuerProfile;
};

export type OidcIssuerProfile = {
  readonly enabled: boolean;
};

export type NetworkProfile = {
  readonly networkPlugin: string;
  readonly networkPluginMode: string;
  readonly networkPolicy: string;
  readonly networkDataplane: string;
  readonly loadBalancerSku: string;
  readonly loadBalancerProfile: LoadBalancerProfile;
  readonly podCidr: string;
  readonly serviceCidr: string;
  readonly dnsServiceIP: string;
  readonly outboundType: string;
  readonly podCidrs: string[];
  readonly serviceCidrs: string[];
  readonly ipFamilies: string[];
};

export type LoadBalancerProfile = {
  readonly backendPoolType: string;
};

export type NodeProvisioningProfile = {
  readonly mode: string;
  readonly defaultNodePools: string;
};

export type PrivateLinkResource = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly groupId: string;
  readonly requiredMembers: string[];
};

export type PropertiesSecurityProfile = {
  readonly imageCleaner: ImageCleaner;
  readonly workloadIdentity: OidcIssuerProfile;
};

export type ImageCleaner = {
  readonly enabled: boolean;
  readonly intervalHours: number;
};

export type ServicePrincipalProfile = {
  readonly clientId: string;
};

export type StorageProfile = {
  readonly diskCSIDriver: OidcIssuerProfile;
  readonly fileCSIDriver: OidcIssuerProfile;
  readonly snapshotController: OidcIssuerProfile;
};

export type WindowsProfile = {
  readonly adminUsername: string;
  readonly enableCSIProxy: boolean;
};

export type WorkloadAutoScalerProfile = {
  readonly keda: OidcIssuerProfile;
  readonly verticalPodAutoscaler: OidcIssuerProfile;
};

export type Sku = {
  readonly name: string;
  readonly tier: string;
};

export type Tags = {
  readonly environment: string;
  readonly organization: string;
  readonly 'pulumi-project': string;
};
