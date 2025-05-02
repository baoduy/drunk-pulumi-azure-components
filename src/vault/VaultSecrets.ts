import { AzureResourceInfo } from '../types';
import * as pulumi from '@pulumi/pulumi';
import { SecretItemArgs, VaultSecret } from './VaultSecret';

export type VaultSecretResult = {
    id: pulumi.Output<string>,
    vaultUrl: pulumi.Output<string>,
    version: pulumi.Output<string>,
}
export interface VaultSecretsArgs {
    vaultInfo: AzureResourceInfo;
    secrets: { [key: string]: SecretItemArgs }
}

export class VaultSecrets extends pulumi.ComponentResource {
    public readonly results: {
        [key: string]: VaultSecretResult,
    } = {};

    constructor(name: string, args: VaultSecretsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("drunk-pulumi:index:VaultSecrets", name, args, opts);

        Object.keys(args.secrets).forEach((key) => {
            const secret = new VaultSecret(
                `${name}-${key}`,
                {
                    ...args.secrets[key],
                    vaultInfo: args.vaultInfo,
                },
                opts,
            );

            this.results[key] = {
                id: secret.id,
                vaultUrl: secret.vaultUrl,
                version: secret.version,
            }
        });

        this.registerOutputs({
            results: this.results,
        });
    }
}