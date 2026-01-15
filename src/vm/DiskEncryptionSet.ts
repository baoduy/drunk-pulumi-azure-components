import * as compute from '@pulumi/azure-native/compute';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';

export interface DiskEncryptionSetArgs extends CommonBaseArgs {
  encryptionType: compute.DiskEncryptionSetType;
}

export class DiskEncryptionSet extends BaseResourceComponent<DiskEncryptionSetArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: DiskEncryptionSetArgs, opts?: pulumi.ComponentResourceOptions) {
    super('DiskEncryptionSet', name, args, opts);

    const { rsGroup, enableResourceIdentity, encryptionType, defaultUAssignedId } = args;

    const encryptionKey = this.getEncryptionKey();
    const diskEncrypt = new compute.DiskEncryptionSet(
      name,
      {
        ...rsGroup,
        rotationToLatestKeyVersionEnabled:
          encryptionType !== compute.DiskEncryptionSetType.ConfidentialVmEncryptedWithCustomerKey,
        encryptionType: encryptionType ?? compute.DiskEncryptionSetType.EncryptionAtRestWithPlatformAndCustomerKeys,

        identity: enableResourceIdentity
          ? {
              type: defaultUAssignedId
                ? compute.ResourceIdentityType.SystemAssigned_UserAssigned
                : compute.ResourceIdentityType.SystemAssigned,
              userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
            }
          : undefined,

        activeKey: { keyUrl: encryptionKey.id },
      },
      {
        ...opts,
        deleteBeforeReplace: true,
        replaceOnChanges: ['encryptionType'],
        parent: this,
      },
    );

    if (enableResourceIdentity) this.addIdentityToRole('readOnly', diskEncrypt.identity);

    this.id = diskEncrypt.id;
    this.resourceName = diskEncrypt.name;

    this.registerOutputs();
  }

  public getOutputs(): types.ResourceOutputs {
    return {
      id: this.id,
      resourceName: this.resourceName,
      resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
    };
  }
}
