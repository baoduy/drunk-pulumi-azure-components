import * as inputs from '@pulumi/azure-native/types/input';
import * as network from '@pulumi/azure-native/network';

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
  private _rules: inputs.network.SecurityRuleArgs[] = [];

  private addRule(
    name: string,
    props: RuleItemArgs & { access: network.SecurityRuleAccess; direction: network.SecurityRuleDirection },
  ): SecurityRuleBuilder {
    this._rules.push({
      name,
      protocol: '*',
      sourceAddressPrefix: '*',
      sourcePortRange: '*',
      destinationAddressPrefix: '*',
      destinationPortRange: '*',
      ...props,
    });

    return this;
  }

  public allowInbound(name: string, props: RuleItemArgs): SecurityRuleBuilder {
    return this.addRule(name, {
      access: 'Allow',
      direction: 'Inbound',
      ...props,
    });
  }

  public denyInbound(name: string, props: RuleItemArgs): SecurityRuleBuilder {
    return this.addRule(name, {
      access: 'Deny',
      direction: 'Inbound',
      ...props,
    });
  }

  public allowOutbound(name: string, props: RuleItemArgs) {
    return this.addRule(name, {
      access: 'Allow',
      direction: 'Outbound',
      ...props,
    });
  }

  public denyOutbound(name: string, props: RuleItemArgs) {
    return this.addRule(name, {
      access: 'Deny',
      direction: 'Outbound',
      ...props,
    });
  }

  build(startPriority: number = 300) {
    const rules = this._rules.map((rule, index) => {
      rule.priority = startPriority + index;
      return rule;
    });

    return rules;
  }
}
