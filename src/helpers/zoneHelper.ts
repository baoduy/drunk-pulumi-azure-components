/**
 * @module zoneHelper
 * @description Helper module for managing Azure availability zones configuration
 */

import * as pulumi from "@pulumi/pulumi";

import { isPrd } from "./azureEnv";

/**
 * Default availability zones for PRD environment
 * Azure supports zones 1, 2, and 3 for high availability
 */
const DEFAULT_PRD_ZONES: string[] = ["1", "2", "3"];

/**
 * Gets the default zones configuration based on environment
 *
 * @param zones - Optional zones override from component configuration
 * @returns Array of zone strings for PRD environment, or undefined/provided zones otherwise
 *
 * @example
 * // In PRD environment with no override
 * getDefaultZones() // Returns ['1', '2', '3']
 *
 * @example
 * // In PRD environment with override
 * getDefaultZones(['1']) // Returns ['1']
 *
 * @example
 * // In non-PRD environment
 * getDefaultZones() // Returns undefined
 */

export function getDefaultZones(
  zones?: pulumi.Input<pulumi.Input<string>[]>
): pulumi.Input<pulumi.Input<string>[]> | undefined {
  // If zones are explicitly provided, always use them (allows override)
  if (zones !== undefined) {
    return zones;
  }

  // Only default to 3 zones for PRD environment
  return isPrd ? DEFAULT_PRD_ZONES : undefined;
}
