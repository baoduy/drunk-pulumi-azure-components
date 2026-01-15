import * as cert from '@pulumi/azure-native/certificateregistration';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';

export interface AppCertArgs extends CommonBaseArgs, Partial<Pick<cert.AppServiceCertificateOrderArgs, 'keySize'>> {
  productType: 'Standard' | 'WildCard';
  domain: string;
}

export class AppCert extends BaseResourceComponent<AppCertArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;
  public readonly domainVerificationToken: pulumi.Output<string>;

  constructor(name: string, args: AppCertArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AppCert', name, args, opts);

    const { rsGroup, productType, keySize, domain } = args;
    const appCert = new cert.AppServiceCertificateOrder(
      name,
      {
        ...rsGroup,
        location: 'global',
        productType:
          productType === 'Standard'
            ? cert.CertificateProductType.StandardDomainValidatedSsl
            : cert.CertificateProductType.StandardDomainValidatedWildCardSsl,
        autoRenew: true,
        distinguishedName: productType === 'Standard' ? `CN=${domain}` : `CN=*.${domain}`,
        keySize: keySize ?? 2048,
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

    //Grant this Microsoft.Azure.CertificateRegistration appId=`f3c21649-0979-4721-ac85-b0216b2cf413` objectId=`f509b0a6-e3b6-4876-90df-404ea160095a` to have access to the Key Vault certificate.
    this.addIdentityToRole('contributor', { principalId: 'f509b0a6-e3b6-4876-90df-404ea160095a' });

    this.domainVerificationToken = appCert.domainVerificationToken;
    this.id = appCert.id;
    this.resourceName = appCert.name;

    this.registerOutputs();
  }

  public getOutputs(): types.ResourceOutputs & { domainVerificationToken?: pulumi.Output<string> } {
    return {
      id: this.id,
      resourceName: this.resourceName,
      resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
      domainVerificationToken: this.domainVerificationToken,
    };
  }
}
