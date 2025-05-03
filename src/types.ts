import * as pulumi from "@pulumi/pulumi";
import { ResourceGroup } from "@pulumi/azure-native/resources";

export type ResourceGroupInfo = {
    resourceGroupName: pulumi.Input<string>;
    location?: pulumi.Input<string>;
};

export type WithResourceGroupInfo = {
    rsGroupInfo: ResourceGroupInfo;
};

export type WithResourceGroup = {
    rsGroup?: ResourceGroupInfo | ResourceGroup;
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