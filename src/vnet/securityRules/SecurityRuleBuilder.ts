import * as inputs from '@pulumi/azure-native/types/input';

type RuleItemArgs = Partial<
  Pick<
    inputs.network.SecurityRuleArgs,
    | 'description'
    | 'protocol'
    | 'sourceAddressPrefix'
    | 'destinationAddressPrefix'
    | 'destinationAddressPrefixes'
    | 'destinationPortRange'
    | 'destinationPortRanges'
    | 'sourceAddressPrefixes'
    | 'sourcePortRange'
    | 'sourcePortRanges'
  >
>;

export class SecurityRuleBuilder {
  private rules: inputs.network.SecurityRuleArgs[] = [];

  public allowInbound(name: string, props: RuleItemArgs): SecurityRuleBuilder {
    this.rules.push({
      name,
      access: 'Allow',
      direction: 'Inbound',
      protocol: '*',
      sourceAddressPrefix: '*',
      sourcePortRange: '*',
      destinationAddressPrefix: '*',
      destinationPortRange: '*',
      ...props,
    });
    return this;
  }

  public allowOutbound(name: string, props: RuleItemArgs) {
    this.rules.push({
      name,
      access: 'Allow',
      direction: 'Outbound',
      protocol: '*',
      sourceAddressPrefix: '*',
      sourcePortRange: '*',
      destinationAddressPrefix: '*',
      destinationPortRange: '*',
      ...props,
    });
    return this;
  }

  build(startPriority: number = 300) {
    this.rules.forEach((rule, index) => {
      rule.priority = startPriority + index;
    });
    return this.rules;
  }
}
