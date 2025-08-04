import * as authorization from '@pulumi/azure-native/authorization';
import * as pulumi from '@pulumi/pulumi';

export interface ResourceLockerArgs {
  resource: pulumi.CustomResource;
  level?: authorization.LockLevel;
}

export class ResourceLocker extends pulumi.ComponentResource<ResourceLockerArgs> {
  constructor(name: string, args: ResourceLockerArgs, opts?: pulumi.ComponentResourceOptions) {
    if (!args.level) args.level = authorization.LockLevel.CanNotDelete;
    super('drunk-pulumi:index:ResourceLocker', name, args, opts);

    new authorization.ManagementLockByScope(
      name,
      {
        level: args.level,
        scope: args.resource.id,
        notes: `Lock ${name} from ${args.level}`,
      },
      { ...opts, parent: this, retainOnDelete: true },
    );
  }
}
