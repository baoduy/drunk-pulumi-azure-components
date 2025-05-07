import { azRegions } from './LocationBuiltIn';

const normalizeString = (str: string): string => {
  return str.replace(/\s+/g, '').toLowerCase();
};

export const getLocation = (possibleName: string) => {
  const nameWithoutSpace = normalizeString(possibleName);
  const location = azRegions.find(
    (l) => l.name === nameWithoutSpace || normalizeString(l.display_name) === nameWithoutSpace,
  );
  return location?.display_name ?? 'Southeast Asia';
};

export const getCountryCode = (possibleName: string) => {
  const nameWithoutSpace = normalizeString(possibleName);
  const location = azRegions.find(
    (l) => l.name === nameWithoutSpace || normalizeString(l.display_name) === nameWithoutSpace,
  );
  return location?.country_code ?? 'SG';
};

export const getRegionCode = (possibleName: string) => {
  const nameWithoutSpace = normalizeString(possibleName);
  const location = azRegions.find(
    (l) => l.name === nameWithoutSpace || normalizeString(l.display_name) === nameWithoutSpace,
  );
  return location?.name ?? 'southeastasia';
};
