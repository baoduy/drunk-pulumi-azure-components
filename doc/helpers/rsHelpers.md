# rsHelpers.ts

**File Path:** `helpers/rsHelpers.ts`

## Purpose

Removes leading and trailing dashes from a string and replaces multiple consecutive dashes with a single dash

## Dependencies

- `@pulumi/pulumi`
- `../types`
- `./azureEnv`
- `./stackEnv`

## Functions

### removeDashes

Removes leading and trailing dashes from a string and replaces multiple consecutive dashes with a single dash

### getNameNormalize

getNameNormalize function implementation.

### getShortName

Gets a shortened name by removing organization, project name and stack information

### getRsNameFromId

Extracts the resource name from a resource ID or domain

### getRsNameFromIdOutput

Converts a Pulumi Input string resource ID to an Output containing just the resource name

### getRsInfoFromId

Parses an Azure resource ID string to extract resource information

### getRsInfoFromIdOutputs

Converts a Pulumi Input string resource ID to an Output containing parsed resource information

## Exports

- `removeDashes`
- `getNameNormalize`
- `getShortName`
- `getRsGroupIdFrom`
- `getRsNameFromId`
- `getRsNameFromIdOutput`
- `getRsInfoFromId`
- `getRsInfoFromIdOutputs`
