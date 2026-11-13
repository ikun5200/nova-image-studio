import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BING_WALLPAPER_INDEX_COUNT,
  BING_WALLPAPER_URL,
  buildBingWallpaperUrl,
} from '@/lib/constants';

function indexOf(url: string): number {
  return Number(new URL(url).searchParams.get('index'));
}

describe('buildBingWallpaperUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('picks an index from the rolling pool and adds a cache-busting timestamp', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    vi.spyOn(Date, 'now').mockReturnValue(123456);

    const url = buildBingWallpaperUrl();

    expect(url.startsWith(BING_WALLPAPER_URL)).toBe(true);
    expect(indexOf(url)).toBe(BING_WALLPAPER_INDEX_COUNT - 1);
    expect(new URL(url).searchParams.get('_t')).toBe('123456');
  });

  it('keeps the index inside the supported 0..7 range', () => {
    for (const random of [0, 0.125, 0.5, 0.999]) {
      vi.spyOn(Math, 'random').mockReturnValue(random);
      const index = indexOf(buildBingWallpaperUrl());
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(BING_WALLPAPER_INDEX_COUNT);
    }
  });
});
