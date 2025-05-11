/**
 * Formats the component resource type to ensure it follows the drunk-pulumi naming convention
 * @param type - The resource type string
 * @returns Formatted resource type string with drunk-pulumi prefix if not already present
 */
export function getComponentResourceType(type: string) {
  return type.includes('drunk-pulumi') ? type : `drunk:pulumi:${type}`;
}

export function arrayToMap<T extends { [key: string | number]: any }>(
  array: T[],
  key: keyof T,
  transformer?: (value: T) => any,
): { [key: string | number]: T } {
  return array.reduce((acc, curr) => {
    const keyValue = curr[key];
    if (keyValue) {
      acc[keyValue] = transformer ? transformer(curr) : curr;
    }
    return acc;
  }, {} as { [key: string]: T });
}

export function recordMap<Tin extends any, Tout>(
  records: Record<string, Tin>,
  transform: (value: Tin) => Tout,
): Record<string, Tout> {
  return Object.entries(records).reduce(
    (acc, [name, item]) => ({
      ...acc,
      [name]: transform(item),
    }),
    {},
  );
}
