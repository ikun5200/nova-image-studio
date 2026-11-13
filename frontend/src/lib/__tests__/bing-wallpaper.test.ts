import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BA_RANDOM_IMAGE_URL,
  BING_WALLPAPER_INDEX_COUNT,
  BING_WALLPAPER_URL,
  buildBaRandomImageUrl,
  buildBingWallpaperUrl,
} from '@/lib/constants';

const TEST_ORIGIN = 'http://localhost';

function parseUrl(url: string): URL {
  return new URL(url, TEST_ORIGIN);
}

function indexOf(url: string): number {
  return Number(parseUrl(url).searchParams.get('index'));
}

describe('random image proxy URLs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('picks a Bing index from the rolling pool and adds a cache-busting timestamp', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    vi.spyOn(Date, 'now').mockReturnValue(123456);

    const url = buildBingWallpaperUrl();
    const parsed = parseUrl(url);

    expect(url.startsWith(BING_WALLPAPER_URL)).toBe(true);
    expect(parsed.pathname).toBe('/api/nova/random-image');
    expect(parsed.searchParams.get('source')).toBe('bing');
    expect(indexOf(url)).toBe(BING_WALLPAPER_INDEX_COUNT - 1);
    expect(parsed.searchParams.get('_t')).toBe('123456');
  });

  it('keeps the Bing index inside the supported 0..7 range', () => {
    for (const random of [0, 0.125, 0.5, 0.999]) {
      vi.spyOn(Math, 'random').mockReturnValue(random);
      const index = indexOf(buildBingWallpaperUrl());
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(BING_WALLPAPER_INDEX_COUNT);
    }
  });

  it('routes BA images through the same-origin proxy', () => {
    const url = buildBaRandomImageUrl();
    const parsed = parseUrl(url);

    expect(url.startsWith(BA_RANDOM_IMAGE_URL)).toBe(true);
    expect(parsed.pathname).toBe('/api/nova/random-image');
    expect(parsed.searchParams.get('source')).toBe('ba');
    expect(parsed.searchParams.get('_t')).not.toBeNull();
  });
});
