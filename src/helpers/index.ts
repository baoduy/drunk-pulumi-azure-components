export * as azureEnv from './azureEnv';
export * as configHelper from './configHelper';
export * as stackInfo from './stackEnv';

export const removeLeadingAndTrailingDash = (s: string) => s.replace(/^-|-$/g, '');

/**
 * Converts an array to dictionary using a key selector
 * @example
 * const users = [{id: 1, name: 'Alice'}, {id: 2, name: 'Bob'}]
 * arrayToDict(users, u => u.id) // {1: {id:1,name:'Alice'}, 2: {id:2,name:'Bob'}}
 */
export function arrayToDict<T, K extends string | number | symbol>(
  items: T[],
  keySelector: (item: T) => K,
  valueSelector?: (item: T) => any,
): Record<K, T> {
  return items.reduce((acc, item) => {
    const key = keySelector(item);
    acc[key] = valueSelector ? valueSelector(item) : item;
    return acc;
  }, {} as Record<K, T>);
}

/**
 * Converts an object to flat dictionary with key-value pairs
 * @example
 * objectToDict({user: {name: 'Alice'}, age: 30})
 * // {'user.name': 'Alice', 'age': 30}
 */
export function objectToDict<T extends object>(obj: T, separator = '.'): Record<string, any> {
  const result: Record<string, any> = {};

  const traverse = (current: any, path: string = '') => {
    Object.entries(current).forEach(([key, value]) => {
      const newPath = path ? `${path}${separator}${key}` : key;
      if (typeof value === 'object' && value !== null) {
        traverse(value, newPath);
      } else {
        result[newPath] = value;
      }
    });
  };

  traverse(obj);
  return result;
}

/**
 * Creates new dictionary with only selected fields
 * @example
 * selectDictFields({a: 1, b: 2, c: 3}, ['a', 'c']) // {a: 1, c: 3}
 */
export function selectDictFields<T extends object, K extends keyof T>(dict: T, fields: K[]): Pick<T, K> {
  return fields.reduce((acc, key) => {
    if (dict.hasOwnProperty(key)) {
      acc[key] = dict[key];
    }
    return acc;
  }, {} as Pick<T, K>);
}
