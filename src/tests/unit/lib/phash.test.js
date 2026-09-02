import { describe, it, expect, vi } from 'vitest';
import { calculateSimilarity } from '../../../lib/phash';

vi.unmock('../../../lib/phash');

describe('calculateSimilarity', () => {
  it('should return exactly 1.0 for identical features', () => {
    const feat1 = {
      dHash: 'ffff0000ffff0000',
      hsvHist: new Array(32).fill(0.03125),
      spatialBlocks: new Array(16).fill({ lumaAvg: 128 })
    };
    
    const score = calculateSimilarity(feat1, feat1);
    expect(score).toBeCloseTo(1.0, 5);
  });

  it('should score identical features highly', () => {
    const feat = { 
      hsvHist: Array(32).fill(0.03125), 
      dHash: '1'.repeat(64),
      spatialBlocks: Array(16).fill({ lumaAvg: 128 })
    };
    
    const score = calculateSimilarity(feat, feat);
    expect(score).toBeGreaterThan(0.95);
  });

  it('should penalize differing dHashes heavily', () => {
    const feat1 = { 
      hsvHist: Array(32).fill(0.03125), 
      dHash: '1'.repeat(64),
      spatialBlocks: Array(16).fill({ lumaAvg: 128 })
    };
    const feat2 = { 
      hsvHist: Array(32).fill(0).fill(1, 0, 1), // completely different hist
      dHash: '0'.repeat(64),
      spatialBlocks: Array(16).fill({ lumaAvg: 0 })
    };
    
    const score = calculateSimilarity(feat1, feat2);
    expect(score).toBeLessThan(0.6);
  });
});
