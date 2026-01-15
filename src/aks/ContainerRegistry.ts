import * as pulumi from '@pulumi/pulumi';
import * as registry from '@pulumi/azure-native/containerregistry';
import * as types from '../types';

import { BaseResourceComponent, CommonBaseArgs } from '../base';

import { PrivateEndpoint } from '../vnet';

export interface ContainerRegistryArgs
  extends
    CommonBaseArgs,
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

    const acr = this.createAcr();
    this.createPrivateLink(acr);

    this.id = acr.id;
    this.resourceName = acr.name;

    this.registerOutputs();
  }

  public getOutputs(): types.ResourceOutputs {
    return {
      id: this.id,
      resourceName: this.resourceName,
      resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
    };
  }

  private createAcr() {
    const {
      rsGroup,
      enableEncryption,
      enableResourceIdentity,
      defaultUAssignedId,
      retentionDaysPolicy,
      sku,
      network,
      ...props
    } = this.args;
    const encryptionKey = sku === 'Premium' && enableEncryption ? this.getEncryptionKey() : undefined;
    const alphanumericString = (this.name.match(/[a-zA-Z0-9]+/g) || []).join('');

    return new registry.Registry(
      alphanumericString,
      {
        ...props,
        ...rsGroup,

        sku: { name: sku },
        adminUserEnabled: false,
        anonymousPullEnabled: false,
        zoneRedundancy: sku != 'Basic' && props.zoneRedundancy ? 'Enabled' : 'Disabled',

        identity: enableResourceIdentity
          ? {
              type: defaultUAssignedId
                ? registry.ResourceIdentityType.SystemAssigned_UserAssigned
                : registry.ResourceIdentityType.SystemAssigned,

              userAssignedIdentities: defaultUAssignedId
                ? pulumi.output(defaultUAssignedId).apply((id) => ({ [id.id]: {} }))
                : undefined,
            }
          : undefined,

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
      { ...this.opts, parent: this },
    );
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
