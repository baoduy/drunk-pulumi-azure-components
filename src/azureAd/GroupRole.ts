import * as pulumi from "@pulumi/pulumi";
import * as azAd from "@pulumi/azuread";
import { AzRole } from './AzRole';
import { BaseArgs, BaseComponentResource } from '../base';

export enum GroupRoleTypes {
    Admin = "Admin",
    Contributor = "Contributor",
    ReadOnly = "ReadOnly",
}

export interface GroupRoleArgs extends BaseArgs, Pick<azAd.GroupArgs, 'owners'> {
    admin?: Pick<azAd.GroupArgs, 'members'>;
    contributor?: Pick<azAd.GroupArgs, 'members'>;
    readOnly?: Pick<azAd.GroupArgs, 'members'>;
}

export interface GroupRoleOutput {
    id: string;
    name: string;
}
export class GroupRole extends BaseComponentResource<GroupRoleArgs> {

    public readonly admin: pulumi.Output<GroupRoleOutput>;
    public readonly contributor: pulumi.Output<GroupRoleOutput>;
    public readonly readOnly: pulumi.Output<GroupRoleOutput>;

    constructor(name: string, args: GroupRoleArgs, opts?: pulumi.ComponentResourceOptions) {
        super("GroupRole", name, args, opts);

        const admin = new AzRole(`${name} admin`, { vaultInfo: args.vaultInfo, owners: args.owners, members: args.admin?.members }, { parent: this });
        const contributor = new AzRole(`${name} contributor`, { vaultInfo: args.vaultInfo, owners: args.owners, members: args.admin?.members }, { parent: this });
        const readOnly = new AzRole(`${name} readOnly`, { vaultInfo: args.vaultInfo, owners: args.owners, members: args.admin?.members }, { parent: this });

        this.admin = pulumi.output({
            id: admin.id,
            name: admin.displayName,
        });
        this.contributor = pulumi.output({
            id: contributor.id,
            name: contributor.displayName,
        });
        this.readOnly = pulumi.output({
            id: readOnly.id,
            name: readOnly.displayName,
        });

        this.registerOutputs({
            admin: this.admin,
            contributor: this.contributor,
            readOnly: this.readOnly,
        });
    }
}