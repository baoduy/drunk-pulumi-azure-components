import { VaultKeyResource } from '@drunk-pulumi/azure-providers';
import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from '../base/helpers';
import { WithVaultInfo } from '../types';
import { BaseComponent } from '../base/BaseComponent';

export interface EncryptionKeyArgs extends Required<WithVaultInfo> {
  keySize?: 2048 | 3072 | 4096;
}

export class EncryptionKey extends BaseComponent<EncryptionKeyArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly keyName: pulumi.Output<string>;
  public readonly urlWithoutVersion: pulumi.Output<string>;
  public readonly vaultUrl: pulumi.Output<string>;
  public readonly version: pulumi.Output<string>;

  constructor(name: string, args: EncryptionKeyArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('EncryptionKey'), name, args, opts);
    const key = new VaultKeyResource(
      `${name}-encryptKey`,
      {
        name: `${name}-encryptKey`,
        vaultName: args.vaultInfo.resourceName,
        key: { keySize: args.keySize ?? 4096 },
      },
      { ...opts, parent: this, retainOnDelete: true },
    );

    const urlWithoutVersion = pulumi.output([key.version, key.id]).apply(([v, id]) => id.replace(`/${v}`, ''));

    this.id = key.id;
    this.keyName = key.name;
    this.urlWithoutVersion = urlWithoutVersion;
    this.vaultUrl = key.vaultUrl;
    this.version = key.version;

    this.registerOutputs(this.getOutputs());
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      id: this.id,
      keyName: this.keyName,
      urlWithoutVersion: this.urlWithoutVersion,
      vaultUrl: this.vaultUrl,
      version: this.version,
    };
  }
}
