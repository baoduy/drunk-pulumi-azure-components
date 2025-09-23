import * as apim from '@pulumi/azure-native/apimanagement';
import * as pulumi from '@pulumi/pulumi';

import { ApimApiSet, ApimApiSetArgs } from './ApimApiSet';
import { BaseResourceComponent, CommonBaseArgs } from '../base';

import { ApimPolicyBuilder } from './ApimPolicyBuilder';
import * as types from '../types';

export interface ApimProductArgs
  extends CommonBaseArgs,
    Omit<apim.ProductArgs, types.CommonProps | 'displayName' | 'subscriptionRequired'> {
  displayName?: pulumi.Input<string>;
  subscriptionRequired?: boolean;
  enableDiagnostic?: boolean;
  policyBuilder?: (policy: ApimPolicyBuilder) => ApimPolicyBuilder;
  apiSets?: Array<
    Omit<ApimApiSetArgs, types.CommonProps | 'serviceName' | 'vaultInfo' | 'enableDiagnostic' | 'productId'> & {
      name: string;
    }
  >;
}

export class ApimProduct extends BaseResourceComponent<ApimProductArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: ApimProductArgs, opts?: pulumi.ComponentResourceOptions) {
    super('ApimProduct', name, args, opts);

    const product = this.buildProduct();
    this.buildSubscription(product);
    this.buildApiSets(product);

    this.id = product.id;
    this.resourceName = product.name;
    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  private buildProduct() {
    const {
      rsGroup,
      productId,
      displayName,
      description,
      policyBuilder,
      serviceName,
      approvalRequired,
      apiSets,
      enableDiagnostic,
      groupRoles,
      vaultInfo,
      subscriptionRequired = true,
      subscriptionsLimit = 5,
      ...others
    } = this.args;

    const product = new apim.Product(
      this.name,
      {
        ...rsGroup,
        ...others,
        serviceName,
        approvalRequired: subscriptionRequired ? approvalRequired : undefined,
        subscriptionRequired: subscriptionRequired ?? true,
        subscriptionsLimit: subscriptionRequired ? subscriptionsLimit : undefined,
        productId: productId ?? this.name,
        displayName: displayName ?? this.name,
        description: description ?? this.name,
      },
      { ...this.opts, parent: this },
    );

    if (policyBuilder) {
      new apim.ProductPolicy(
        `${this.name}-policy`,
        {
          ...rsGroup,
          serviceName,
          productId: productId ?? this.name,
          format: 'xml',
          policyId: 'policy',
          value: policyBuilder(new ApimPolicyBuilder()).build(),
        },
        { dependsOn: product, deletedWith: product, parent: this },
      );
    }

    return product;
  }

  private buildSubscription(product: apim.Product) {
    const { productId, serviceName, rsGroup, subscriptionRequired } = this.args;
    if (!subscriptionRequired) return;

    const subName = `${this.name}-sub`;
    const primaryKey = `apim-${subName}-primary`;
    const secondaryKey = `apim-${subName}-secondary`;
    const primaryPass = this.createPassword({ name: primaryKey, length: 50, policy: 'yearly' });
    const secondaryPass = this.createPassword({ name: secondaryKey, length: 50, policy: 'yearly' });

    const sub = new apim.Subscription(
      subName,
      {
        ...rsGroup,
        sid: subName,
        displayName: subName,
        serviceName,
        scope: pulumi.interpolate`/products/${productId ?? this.name}`,
        state: 'active',
        primaryKey: primaryPass.value,
        secondaryKey: secondaryPass.value,
      },
      { dependsOn: [product, primaryPass, secondaryPass], deletedWith: product, parent: this },
    );

    this.addSecrets({
      [primaryKey]: primaryPass.value,
      [secondaryKey]: secondaryPass.value,
    });

    return sub;
  }

  private buildApiSets(product: apim.Product) {
    const { productId, rsGroup, serviceName, enableDiagnostic, subscriptionRequired, apiSets } = this.args;
    if (!apiSets) return;

    return apiSets.map(
      (s) =>
        new ApimApiSet(
          s.name,
          { ...s, rsGroup, serviceName, productId: productId ?? this.name, enableDiagnostic, subscriptionRequired },
          { dependsOn: product, deletedWith: product, parent: this },
        ),
    );
  }
}
