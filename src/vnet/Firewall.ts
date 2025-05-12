import * as network from '@pulumi/azure-native/network';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';

export type RulePolicyArgs = {
  priority: number;
  name: string;
  ruleCollections?: pulumi.Input<
    pulumi.Input<
      inputs.network.FirewallPolicyFilterRuleCollectionArgs | inputs.network.FirewallPolicyNatRuleCollectionArgs
    >[]
  >;
};

export interface FirewallArgs
  extends CommonBaseArgs,
    types.WithUserAssignedIdentity,
    types.WithEncryptionEnabler,
    Pick<
      network.AzureFirewallArgs,
      | 'autoscaleConfiguration'
      | 'tags'
      | 'virtualHub'
      | 'zones'
      | 'managementIpConfiguration'
      | 'ipConfigurations'
      | 'hubIPAddresses'
      | 'threatIntelMode'
    > {
  sku: {
    name: network.AzureFirewallSkuName;
    tier: network.AzureFirewallSkuTier;
  };
  additionalProperties?: Record<string, pulumi.Input<string>>;

  snat?: {
    routeServerId?: pulumi.Input<string>;
  };

  policy: Pick<
    network.FirewallPolicyArgs,
    | 'dnsSettings'
    | 'explicitProxy'
    | 'insights'
    | 'intrusionDetection'
    | 'sql'
    | 'threatIntelMode'
    | 'threatIntelWhitelist'
  > & {
    basePolicy?: types.ResourceInputs;
    transportSecurityCA?: pulumi.Input<inputs.network.FirewallPolicyCertificateAuthorityArgs>;
    /** The rule collections for this Firewall. Recommend to use "FirewallPolicyBuilder" to build this rules */
    rules?: Array<RulePolicyArgs>;
  };

  logs?: {
    defaultWorkspace: types.ResourceInputs;
    regionalWorkspaces?: Array<{ id: pulumi.Input<string>; region: pulumi.Input<string> }>;
  };
}

export class Firewall extends BaseResourceComponent<FirewallArgs> {
  public readonly firewall: types.ResourceOutputs;
  public readonly policy: types.ResourceOutputs;
  public readonly privateIpAddress: pulumi.Output<string>;

  constructor(name: string, args: FirewallArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Firewall', name, args, opts);

    const policy = this.createPolicy();
    const firewall = this.createFirewall(policy);
    this.createPolicyRuleGroup(policy);

    this.firewall = { id: firewall.id, resourceName: firewall.name };
    this.policy = { id: policy.id, resourceName: policy.name };
    this.privateIpAddress = firewall.ipConfigurations.apply((config) => config![0].privateIPAddress);

    // Export the resource ID
    this.registerOutputs({ firewall: this.firewall, policy: this.policy, privateIpAddress: this.privateIpAddress });
  }

  private createPolicy(basePolicy?: types.ResourceInputs) {
    const {
      rsGroup,
      sku,
      policy: { rules, ...policy },
      logs,
    } = this.args;

    return new network.FirewallPolicy(
      this.name,
      {
        ...policy,
        ...rsGroup,
        sku,
        basePolicy: basePolicy ? { id: basePolicy.id } : undefined,
        dnsSettings:
          policy.dnsSettings ?? sku.tier !== network.FirewallPolicySkuTier.Basic
            ? {
                enableProxy: true,
              }
            : undefined,

        snat: {
          //Auto learn need a Route Server
          autoLearnPrivateRanges: 'Enabled',
          privateRanges: ['IANAPrivateRanges'],
        },

        threatIntelMode:
          policy.threatIntelMode ?? sku.tier !== network.FirewallPolicySkuTier.Basic
            ? network.AzureFirewallThreatIntelMode.Deny
            : undefined,
        threatIntelWhitelist: policy.threatIntelWhitelist ?? {
          fqdns: ['*.microsoft.com'],
          ipAddresses: ['20.3.4.5'],
        },

        transportSecurity:
          sku.tier !== network.FirewallPolicySkuTier.Basic && policy.transportSecurityCA
            ? { certificateAuthority: policy.transportSecurityCA }
            : undefined,

        insights: logs
          ? {
              isEnabled: true,
              logAnalyticsResources: {
                defaultWorkspaceId: { id: logs.defaultWorkspace.id },
                workspaces: logs.regionalWorkspaces
                  ? logs.regionalWorkspaces.map((wp) => ({
                      region: wp.region,
                      workspaceId: { id: wp.id },
                    }))
                  : undefined,
              },
            }
          : undefined,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }

  private createFirewall(firewallPolicy: network.FirewallPolicy) {
    const { rsGroup, sku, logs, policy, snat, additionalProperties, ...props } = this.args;
    const properties: Record<string, pulumi.Input<string>> = {
      ...additionalProperties,
      //autoLearnPrivateRanges: 'Enabled',
      //privateRanges: 'IANAPrivateRanges',
    };

    if (snat) {
      if (snat.routeServerId) properties['Network.RouteServerInfo.RouteServerID'] = snat.routeServerId;
    }

    return new network.AzureFirewall(
      this.name,
      {
        ...props,
        ...rsGroup,
        sku,
        additionalProperties: properties,
        firewallPolicy: firewallPolicy ? { id: firewallPolicy.id } : undefined,
        threatIntelMode:
          props.threatIntelMode ?? (sku.tier !== network.AzureFirewallSkuTier.Basic && sku.name !== 'AZFW_Hub')
            ? network.AzureFirewallThreatIntelMode.Deny
            : undefined,
      },
      { ...this.opts, dependsOn: firewallPolicy ? firewallPolicy : this.opts?.dependsOn, parent: this },
    );
  }

  private createPolicyRuleGroup(firewallPolicy: network.FirewallPolicy) {
    const { policy, rsGroup } = this.args;
    if (!policy.rules) return;

    policy.rules
      .sort((a, b) => a.priority - b.priority)
      .map(
        (p) =>
          new network.FirewallPolicyRuleCollectionGroup(
            `${this.name}-${p.name}`,
            {
              ...rsGroup,
              ...p,
              firewallPolicyName: firewallPolicy.name,
            },
            { dependsOn: [firewallPolicy], parent: this },
          ),
      );
  }
}
