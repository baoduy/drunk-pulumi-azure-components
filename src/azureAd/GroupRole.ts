import * as pulumi from "@pulumi/pulumi";

export enum GroupRoleTypes {
    Admin = "Admin",
    Contributor = "Contributor",
    ReadOnly = "ReadOnly",
}

export interface GroupRoleArgs {

}

export class GroupRole extends pulumi.ComponentResource {
    private _group: pulumi.Output<string>;
    private _role: pulumi.Output<string>;
    constructor(name: string, args: GroupRoleArgs, opts?: pulumi.ComponentResourceOptions) {
        super("azureAd:GroupRole", name, args, opts);
        const resourceName = `${name}-groupRole`;
    }
}