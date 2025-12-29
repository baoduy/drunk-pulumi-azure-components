import * as inputs from '@pulumi/azure-native/types/input';
import * as network from '@pulumi/azure-native/network';
import { RulePolicyArgs } from '../Firewall';

export class FirewallPolicyBuilder {
  private _natRules: Array<inputs.network.NatRuleArgs> = [];
  private _netRules: Array<inputs.network.NetworkRuleArgs> = [];
  private _appRules: Array<inputs.network.ApplicationRuleArgs> = [];

  public constructor(
    public readonly name: string,
    private readonly props: { priority: number; action: network.FirewallPolicyFilterRuleCollectionActionType },
  ) {}

  public addNatRule(name: string, props: Omit<inputs.network.NatRuleArgs, 'name' | 'ruleType'>): FirewallPolicyBuilder {
    this._natRules.push({
      ...props,
      name: `${this.name}-${name}-nat`,
      ruleType: 'NatRule',
    });

    return this;
  }

  public addNetRule(
    name: string,
    props: Omit<inputs.network.NetworkRuleArgs, 'name' | 'ruleType'>,
  ): FirewallPolicyBuilder {
    this._netRules.push({
      ...props,
      name: `${this.name}-${name}-net`,
      ruleType: 'NetworkRule',
    });
    return this;
  }

  public addAppRule(
    name: string,
    props: Omit<inputs.network.ApplicationRuleArgs, 'name' | 'ruleType'>,
  ): FirewallPolicyBuilder {
    this._appRules.push({
      ...props,
      name: `${this.name}-${name}-app`,
      ruleType: 'ApplicationRule',
    });
    return this;
  }

  public build(): RulePolicyArgs {
    const natRules: inputs.network.FirewallPolicyNatRuleCollectionArgs = {
      name: `${this.name}-nat-rules`,
      action: { type: network.FirewallPolicyNatRuleCollectionActionType.DNAT },
      ruleCollectionType: 'FirewallPolicyNatRuleCollection',
      priority: 300,
      rules: this._natRules,
    };

    const rules: inputs.network.FirewallPolicyFilterRuleCollectionArgs = {
      name: `${this.name}-${this.props.action}-rules`,
      action: { type: this.props.action },
      ruleCollectionType: `FirewallPolicyFilterRuleCollection`,
      priority: 400,
      rules: [...this._netRules, ...this._appRules],
    };

    return { name: this.name, priority: this.props.priority, ruleCollections: [natRules, rules] };
  }
}
