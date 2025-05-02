import * as pulumi from '@pulumi/pulumi';
import { WithVaultInfo } from '../types';

export interface AppRegistrationArgs extends WithVaultInfo {

}

export class AppRegistration extends pulumi.ComponentResource {
    constructor(
        name: string,
        args: AppRegistrationArgs,
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("drunk-pulumi:index:PGPGenerator", name, args, opts);
    }
}