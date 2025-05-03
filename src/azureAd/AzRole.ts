import * as pulumi from "@pulumi/pulumi";
import * as azAd from "@pulumi/azuread";
import { stackInfo } from '../helpers';
import { BaseArgs, BaseComponentResource } from '../base';

export interface AzRoleArgs extends BaseArgs, Pick<azAd.GroupArgs, 'owners' | 'members'> {

}

export class AzRole extends BaseComponentResource<AzRoleArgs> {

    public readonly id: pulumi.Output<string>;
    public readonly displayName: pulumi.Output<string>;

    constructor(name: string, args: AzRoleArgs, opts?: pulumi.ComponentResourceOptions) {
        const n = `rol-${name.toLowerCase().replace(/\s+/g, '-')}`
        super("AzRole", n, args, opts);

        const roleName = `ROL ${stackInfo.stack} ${name}`.toUpperCase();
        const role = new azAd.Group(n, {
            displayName: roleName,
            description: roleName,
            members: args.members,
            owners: args.owners,

            securityEnabled: true,
            mailEnabled: false,
            preventDuplicateNames: true,
            assignableToRole: false,
        }, { parent: this });

        this.addSecrets({
            id: role.id,
            displayName: role.displayName,
        });

        this.id = role.id;
        this.displayName = role.displayName;

        this.registerOutputs({
            id: this.id,
            displayName: this.displayName,
        });
    }
}