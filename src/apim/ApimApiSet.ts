import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as pulumi from '@pulumi/pulumi';
import * as apim from '@pulumi/azure-native/apimanagement';
import { ApimApi, ApimApiArgs } from './ApimApi';
import * as types from '../types';

export interface ApimApiSetArgs
  extends CommonBaseArgs,
    Omit<apim.ApiVersionSetArgs, types.CommonProps | 'displayName' | 'description' | 'versioningScheme'> {
  displayName?: pulumi.Input<string>;
  description?: pulumi.Input<string>;
  productId?: pulumi.Input<string>;
  subscriptionRequired?: boolean;
  versioningScheme?: apim.VersioningScheme;
  enableDiagnostic?: boolean;
  apis: Array<
    Omit<ApimApiArgs, types.CommonProps | 'productId' | 'serviceName' | 'enableDiagnostic'> & { name: string }
  >;
}

export class ApimApiSet extends BaseResourceComponent<ApimApiSetArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: ApimApiSetArgs, opts?: pulumi.ComponentResourceOptions) {
    super('ApimApiSet', name, args, opts);

    const apiSet = this.buildApiSet();
    this.buildApis(apiSet);

    this.id = apiSet.id;
    this.resourceName = apiSet.name;
    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  private buildApiSet() {
    const { rsGroup, serviceName, versionSetId, displayName, description, versioningScheme, ...others } = this.args;
    //Create ApiSet
    return new apim.ApiVersionSet(
      this.name,
      {
        ...rsGroup,
        ...others,
        serviceName,
        versionSetId: versionSetId ?? this.name,
        displayName: displayName ?? this.name,
        description: description ?? this.name,
        versioningScheme: versioningScheme ?? apim.VersioningScheme.Segment,
      },
      { ...this.opts, parent: this },
    );
  }

  private buildApis(set: apim.ApiVersionSet) {
    const { apis, rsGroup, serviceName, productId, subscriptionRequired } = this.args;
    if (!apis.length) return;

    return apis.map((a) => {
      return new ApimApi(
        a.name,
        {
          ...a,
          rsGroup,
          serviceName,
          productId,
          subscriptionRequired,
          apiVersionSetId: set.id,
          enableDiagnostic: this.args.enableDiagnostic,
        },
        { dependsOn: set, deletedWith: set, parent: this },
      );
    });
  }
}
