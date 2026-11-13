/**
 * 项目级共享常量
 * 统一管理魔术数字、外部链接等，避免在多文件中重复定义
 */

// ===== 外部 URL =====

/** BA 随机人物图片（原始数据源，仅用于关于页外链） */
export const BA_RANDOM_URL = 'https://img.catcdn.cn/ba/';

/** 随机图片统一走同源代理，避免 ORB/CORS 导致图片加载或图片操作失败。 */
export const BA_RANDOM_IMAGE_URL = '/api/nova/random-image?source=ba';

/** Bing 每日壁纸代理接口；index=0 是今天，1 是昨天，以此类推。 */
export const BING_WALLPAPER_URL = '/api/nova/random-image?source=bing';
export const BING_WALLPAPER_INDEX_COUNT = 8;
/** 关于页展示的数据源主页。 */
export const BING_WALLPAPER_SOURCE_URL = 'https://bing.biturl.top/';

/** 每次刷新随机取最近 8 天中的一张，并带上时间戳绕过浏览器缓存。 */
export function buildBingWallpaperUrl(): string {
  const index = Math.floor(Math.random() * BING_WALLPAPER_INDEX_COUNT);
  return `${BING_WALLPAPER_URL}&index=${index}&_t=${Date.now()}`;
}

export function buildBaRandomImageUrl(): string {
  return `${BA_RANDOM_IMAGE_URL}&_t=${Date.now()}`;
}

// ===== 文件大小限制 =====

/** 上传文件最大字节数（10MB） */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

// ===== 时间间隔（毫秒） =====

/** 冷却/防抖间隔 */
export const COOLDOWN_MS = 5000;

/** Agent 轮询间隔 */
export const AGENT_POLL_INTERVAL_MS = 4000;

// ===== 图像处理 =====

/** 预览图最大边长 */
export const PREVIEW_MAX_SIDE = 512;
