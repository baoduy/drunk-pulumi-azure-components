import { azRegions } from './LocationBuiltIn';

const normalizeString = (str: string): string => {
  return str.replace(/\s+/g, '').toLowerCase();
};

/** Returns the region's display name; a name not in the list is returned unchanged. */
export function getLocation(possibleName: string) {
  const nameWithoutSpace = normalizeString(possibleName);
  const location = azRegions.find(
    (l) => l.name === nameWithoutSpace || normalizeString(l.display_name) === nameWithoutSpace,
  );
  return location?.display_name ?? possibleName;
}

/** Returns the region's ISO country code; a name not in the list returns `''`. */
export function getCountryCode(possibleName: string) {
  const nameWithoutSpace = normalizeString(possibleName);
  const location = azRegions.find(
    (l) => l.name === nameWithoutSpace || normalizeString(l.display_name) === nameWithoutSpace,
  );
  return location?.country_code ?? '';
}

/** Returns the region's programmatic name; a name not in the list returns the input without spaces, lower-cased. */
export function getRegionCode(possibleName: string) {
  const nameWithoutSpace = normalizeString(possibleName);
  const location = azRegions.find(
    (l) => l.name === nameWithoutSpace || normalizeString(l.display_name) === nameWithoutSpace,
  );
  return location?.name ?? nameWithoutSpace;
}
