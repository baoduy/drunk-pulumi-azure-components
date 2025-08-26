import * as registry from '@pulumi/azure-native/containerregistry';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';
import { PrivateEndpoint } from '../vnet/PrivateEndpoint';

export interface ContainerRegistryArgs
  extends CommonBaseArgs,
    types.WithEncryptionEnabler,
    types.WithUserAssignedIdentity,
    Partial<Pick<registry.RegistryArgs, 'dataEndpointEnabled' | 'zoneRedundancy'>> {
  sku: registry.SkuName;
  retentionDaysPolicy?: number;
  network?: Omit<types.NetworkArgs, 'vnetRules'>;
}

export class ContainerRegistry extends BaseResourceComponent<ContainerRegistryArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: ContainerRegistryArgs, opts?: pulumi.ComponentResourceOptions) {
    super('ContainerRegistry', name, args, opts);

    const { rsGroup, enableEncryption, defaultUAssignedId, retentionDaysPolicy, sku, network, ...props } = args;
    const encryptionKey = sku === 'Premium' && enableEncryption ? this.getEncryptionKey() : undefined;
    const alphanumericString = (name.match(/[a-zA-Z0-9]+/g) || []).join('');

    const acr = new registry.Registry(
      alphanumericString,
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

          // userAssignedIdentities: defaultUAssignedId
          //   ? pulumi.output(defaultUAssignedId).apply((id) => ({ [id.id]: id }))
          //   : undefined,
        },

        encryption:
          encryptionKey && defaultUAssignedId
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

  public getOutputs() {
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
