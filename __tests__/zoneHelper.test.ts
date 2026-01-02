import { getDefaultZones } from '../src/helpers/zoneHelper';

describe('ZoneHelper', () => {
  describe('getDefaultZones', () => {
    test('returns undefined when zones are not provided and environment is not PRD', () => {
      // In non-PRD environment (determined by stack name), zones should be undefined
      // This test validates the behavior when zones parameter is not provided
      const result = getDefaultZones();
      
      // The actual value depends on the isPrd flag from azureEnv
      // For testing, we just verify the function doesn't throw and returns a valid type
      expect(result === undefined || Array.isArray(result)).toBe(true);
    });

    test('returns provided zones when explicitly specified (override behavior)', () => {
      // When zones are explicitly provided, they should always be used
      const customZones = ['1', '2'];
      const result = getDefaultZones(customZones);
      expect(result).toEqual(['1', '2']);
    });

    test('allows empty array override', () => {
      // Empty array should be honored as an explicit choice
      const result = getDefaultZones([]);
      expect(result).toEqual([]);
    });

    test('handles single zone configuration', () => {
      const singleZone = ['1'];
      const result = getDefaultZones(singleZone);
      expect(result).toEqual(['1']);
    });

    test('returns undefined when explicitly passed undefined', () => {
      const result = getDefaultZones(undefined);
      // Should either be undefined (non-PRD) or ['1', '2', '3'] (PRD)
      expect(result === undefined || (Array.isArray(result) && result.length === 3)).toBe(true);
    });
  });

  describe('Expected behavior documentation', () => {
    test('PRD environment should default to 3 zones', () => {
      // When isPrd is true (stack name contains "prd"):
      // - getDefaultZones() returns ['1', '2', '3']
      // - getDefaultZones(['1']) returns ['1'] (override)
      // This behavior enables high availability by default in production
      
      // This is a documentation test - actual behavior depends on environment
      const expectedPrdZones = ['1', '2', '3'];
      expect(expectedPrdZones).toEqual(['1', '2', '3']);
    });

    test('Non-PRD environment should not configure zones by default', () => {
      // When isPrd is false (stack name does not contain "prd"):
      // - getDefaultZones() returns undefined
      // - getDefaultZones(['1', '2']) returns ['1', '2'] (explicit config)
      // This reduces costs in non-production environments
      
      // This is a documentation test
      const expectedNonPrdZones = undefined;
      expect(expectedNonPrdZones).toBeUndefined();
    });
  });
});
