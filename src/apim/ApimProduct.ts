import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as pulumi from '@pulumi/pulumi';
import * as apim from '@pulumi/azure-native/apimanagement';
import { ApimPolicyBuilder } from './ApimPolicyBuilder';
import { ApimApiSet, ApimApiSetArgs } from './ApimApiSet';

export interface ApimProductArgs extends CommonBaseArgs, Omit<apim.ProductArgs, 'resourceGroupName'> {
  enableDiagnostic?: boolean;
  policyBuilder?: ApimPolicyBuilder;
  apiSets?: Array<
    Omit<ApimApiSetArgs, 'groupRoles' | 'rsGroup' | 'serviceName' | 'vaultInfo' | 'enableDiagnostic'> & { name: string }
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
    const { rsGroup, productId, displayName, description, policyBuilder, serviceName, ...others } = this.args;

    const product = new apim.Product(
      this.name,
      {
        ...rsGroup,
        ...others,
        serviceName,
        productId: productId ?? this.name,
        displayName: productId ?? this.name,
        description: productId ?? this.name,
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
          value: policyBuilder.build(),
        },
        { dependsOn: product, deletedWith: product, parent: this },
      );
    }

    return product;
  }

  private buildSubscription(product: apim.Product) {
    const { productId, serviceName, rsGroup } = this.args;

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
    const { productId, rsGroup, serviceName, enableDiagnostic, apiSets } = this.args;
    if (!apiSets) return;

    return apiSets.map(
      (s) =>
        new ApimApiSet(
          s.name,
          { ...s, rsGroup, serviceName, productId: productId ?? this.name, enableDiagnostic },
          { dependsOn: product, deletedWith: product, parent: this },
        ),
    );
  }
}
