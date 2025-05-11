import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from './base/helpers';
import * as types from './types';
import { RsGroup } from './common';

export interface ResourceBuilderArgs {
  groupRoles?: {};
}

export class ResourceBuilder extends pulumi.ComponentResource<ResourceBuilderArgs> {
  public readonly rsGroup: types.ResourceGroupOutputs;

  constructor(public name: string, private args: ResourceBuilderArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('ResourceBuilder'), name, args, opts);

    this.rsGroup = new RsGroup(name, args, opts);
  }
}
