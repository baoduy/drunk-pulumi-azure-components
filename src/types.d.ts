import * as pulumi from "@pulumi/pulumi";

export type ResourceGroupInfo = {
    resourceGroupName: string;
    location?: pulumi.Input<string>;
};

export type WithResourceGroupInfo = {
    rsGroupInfo: ResourceGroupInfo;
};

export type AzureResourceInfo = {
    name: pulumi.Input<string>
} & WithResourceGroupInfo;

export type AzureResourceResult = AzureResourceInfo & {
    id: pulumi.Output<string>;
}

export type WithVaultInfo = {
    vaultInfo?: AzureResourceInfo;
};