/**
 * Formats the component resource type to ensure it follows the drunk-pulumi naming convention
 * @param type - The resource type string
 * @returns Formatted resource type string with drunk-pulumi prefix if not already present
 */
export const getComponentResourceType = (type: string) =>
  type.includes('drunk-pulumi') ? type : `drunk:pulumi:${type}`;
