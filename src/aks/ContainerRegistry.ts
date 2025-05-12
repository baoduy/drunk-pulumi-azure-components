import * as pulumi from '@pulumi/pulumi';
import { CommonBaseArgs, BaseResourceComponent } from '../base';
import { PrivateEndpoint } from '../vnet/PrivateEndpoint';
import * as types from '../types';
import * as registry from '@pulumi/azure-native/containerregistry';

export interface ContainerRegistryArgs
  extends CommonBaseArgs,
    types.WithEncryptionEnabler,
    types.WithGroupRolesArgs,
    types.WithUserAssignedIdentity,
    Pick<registry.RegistryArgs, 'dataEndpointEnabled' | 'zoneRedundancy'> {
  sku: registry.SkuName;
  retentionDaysPolicy?: number;
  network?: Omit<types.NetworkArgs, 'vnetRules'>;
}

export class ContainerRegistry extends BaseResourceComponent<ContainerRegistryArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: ContainerRegistryArgs, opts?: pulumi.ComponentResourceOptions) {
    super('ContainerRegistry', name, args, opts);

    const { rsGroup, enableEncryption, groupRoles, defaultUAssignedId, retentionDaysPolicy, sku, network, ...props } =
      args;
    const encryptionKey = enableEncryption ? this.getEncryptionKey() : undefined;

    const acr = new registry.Registry(
      name,
      {
        ...props,
        ...rsGroup,

        sku: { name: sku },
        adminUserEnabled: false,
        anonymousPullEnabled: false,

        //This is for encryption
        identity: {
          type: defaultUAssignedId
            ? registry.ResourceIdentityType.SystemAssigned_UserAssigned
            : registry.ResourceIdentityType.SystemAssigned,

          userAssignedIdentities: defaultUAssignedId
            ? pulumi.output(defaultUAssignedId.id).apply((id) => ({ [id]: defaultUAssignedId }))
            : undefined,
        },

        encryption:
          sku === 'Premium' && encryptionKey && defaultUAssignedId
            ? {
                keyVaultProperties: {
                  identity: defaultUAssignedId.clientId,
                  keyIdentifier: encryptionKey.urlWithoutVersion,
                },
              }
            : undefined,

        policies:
          sku === 'Premium'
            ? {
                exportPolicy: {
                  status: registry.ExportPolicyStatus.Disabled,
                },
                quarantinePolicy: { status: registry.PolicyStatus.Enabled },
                retentionPolicy: {
                  days: retentionDaysPolicy ?? 90,
                  status: registry.PolicyStatus.Enabled,
                },
                trustPolicy: {
                  status: registry.PolicyStatus.Enabled,
                  type: registry.TrustPolicyType.Notary,
                },
              }
            : undefined,

        publicNetworkAccess: network?.publicNetworkAccess ? 'Enabled' : network?.privateLink ? 'Disabled' : 'Enabled',
        networkRuleBypassOptions: network?.bypass,

        networkRuleSet:
          sku === 'Premium' && network
            ? {
                defaultAction: network.defaultAction ?? registry.DefaultAction.Allow,
                ipRules: network.ipRules
                  ? pulumi.output(network.ipRules).apply((ips) =>
                      ips.map((ip) => ({
                        iPAddressOrRange: ip,
                      })),
                    )
                  : undefined,
              }
            : undefined,
      },
      { ...opts, parent: this },
    );

    this.createPrivateLink(acr);

    this.id = acr.id;
    this.resourceName = acr.name;

    this.registerOutputs();
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  private createPrivateLink(acr: registry.Registry) {
    const { rsGroup, network } = this.args;
    if (!network?.privateLink) return;

    return new PrivateEndpoint(
      this.name,
      { ...network.privateLink, resourceInfo: acr, rsGroup, type: 'azurecr' },
      { dependsOn: acr, parent: this },
    );
  }
}
