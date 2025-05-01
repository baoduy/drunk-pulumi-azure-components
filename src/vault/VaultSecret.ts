import { AzureResourceInfo } from '../types';
import * as pulumi from '@pulumi/pulumi';
import { configHelper, stackInfo, removeLeadingAndTrailingDash } from '../helpers';
import { VaultSecretResource } from '@drunk-pulumi/azure-providers/VaultSecret';

export interface VaultSecretArgs {
    vaultInfo: AzureResourceInfo;
    //** The value of the secret. If it is not provided the value will get from project secret. */
    value?: pulumi.Input<string>;
    contentType: pulumi.Input<string>;
    tags?: {
        [key: string]: string;
    };
}

export class VaultSecret extends pulumi.ComponentResource {
    public readonly id: pulumi.Output<string>;
    public readonly url: pulumi.Output<string>;
    public readonly version: pulumi.Output<string>;

    constructor(private name: string, args: VaultSecretArgs, opts?: pulumi.ComponentResourceOptions) {
        super("drunk-pulumi:index:VaultSecret", name, args, opts);
        const secretValue = args.value ?? configHelper.getSecret(name) ?? '';
        const secretName = this.getSecretName();

        const secret = new VaultSecretResource(
            secretName,
            {
                name: secretName,
                value: secretValue,
                vaultName: args.vaultInfo.name,
                contentType: args.contentType,
                tags: args.tags
            },
            opts,
        );

        this.id = secret.id;
        this.url = secret.vaultUrl;
        this.version = secret.version;

        this.registerOutputs({
            id: this.id,
            url: this.url,
            version: this.version
        });
    }

    private getSecretName() {
        const name = this.name
            .replace(new RegExp(stackInfo.stack, 'g'), '') // Replace occurrences of "stack" variable with "-"
            .replace(/\.|_|\s/g, '-') // Replace ".", "_", and spaces with "-"
            .replace(/-+/g, '-') // Replace multiple dashes with a single dash
            .toLowerCase(); // Convert the result to lowercase

        return removeLeadingAndTrailingDash(name);
    }
}