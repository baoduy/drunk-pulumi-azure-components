import * as pulumi from "@pulumi/pulumi";
import * as authorization from '@pulumi/azure-native/authorization';
import { AzureResourceResult } from '../types';

export interface ResourceLockerArgs {
    resource: AzureResourceResult;
    level?: authorization.LockLevel;
}

export class ResourceLocker extends pulumi.ComponentResource {
    constructor(
        args: ResourceLockerArgs,
        opts?: pulumi.ComponentResourceOptions
    ) {
        if (!args.level) args.level = authorization.LockLevel.CanNotDelete;
        const name = `${args.resource.name}-${args.level}-Locker`;
        super("drunk-pulumi:index:ResourceLocker", name, args, opts);

        new authorization.ManagementLockByScope(
            name,
            {
                level: args.level,
                scope: args.resource.id,
                notes: `Lock ${name} from ${args.level}`,
            },
            { ...opts, parent: this },
        );
    }
}