import * as cert from '@pulumi/azure-native/certificateregistration';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';

export interface AppCertArgs
  extends CommonBaseArgs,
    Pick<cert.AppServiceCertificateOrderArgs, 'productType' | 'keySize'> {
  domain: string;
}

export class AppCert extends BaseResourceComponent<AppCertArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AppCertArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AppCert', name, args, opts);

    const appCert = new cert.AppServiceCertificateOrder(
      name,
      {
        ...args.rsGroup,
        location: 'global',
        productType: args.productType,
        autoRenew: true,
        distinguishedName: `CN=*.${args.domain}`,
        keySize: args.keySize ?? 2048,
        validityInYears: 1,
      },
      { ...opts, parent: this },
    );

    if (args.vaultInfo) {
      new cert.AppServiceCertificateOrderCertificate(
        this.name,
        {
          ...args.rsGroup,
          certificateOrderName: appCert.name,
          location: 'global',
          keyVaultSecretName: name,
          keyVaultId: args.vaultInfo.id,
        },
        { dependsOn: appCert, parent: this },
      );
    }

    this.id = appCert.id;
    this.resourceName = appCert.name;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }
}
