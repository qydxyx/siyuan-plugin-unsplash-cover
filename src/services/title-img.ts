import { UnsplashError } from "@/types";
import type { PluginConfig, UnsplashPhoto } from "@/types";

const ALLOWED_HOSTS = new Set(["images.unsplash.com", "plus.unsplash.com"]);
/** Local assets live under data/assets; the kernel appends an id and random suffix. */
const LOCAL_ASSET_PATTERN = /^assets\/[\w\-.]+\.(?:jpg|jpeg|png|webp|avif)$/i;
/** Characters that would break out of the IAL attribute / CSS url() context. */
const FORBIDDEN_CHARACTERS = /["'`()\\<>\s\u0000-\u001f\u007f]/;
const MAX_URL_LENGTH = 2048;

export const UTM_SOURCE = "siyuan_unsplash_plugin";

/** Appends the plugin's UTM parameters, as required by the Unsplash attribution guidelines. */
export function withUtm(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.searchParams.set("utm_source", UTM_SOURCE);
        parsed.searchParams.set("utm_medium", "referral");
        return parsed.toString();
    } catch {
        return url;
    }
}

/**
 * Builds the cover URL from the API-provided URL.
 *
 * The query string is merged instead of rebuilt: Unsplash requires the `ixid`
 * parameter to stay on every resized URL, otherwise photo views cannot be
 * attributed to the application.
 */
export function buildImageUrl(photo: UnsplashPhoto, config: PluginConfig): string {
    const base = photo.urls.raw || photo.urls.full || photo.urls.regular;
    let parsed: URL;
    try {
        parsed = new URL(base);
    } catch {
        return base;
    }
    parsed.searchParams.set("w", String(config.imageWidth));
    parsed.searchParams.set("q", String(config.imageQuality));
    parsed.searchParams.set("fit", "max");
    parsed.searchParams.set("fm", "jpg");
    return parsed.toString();
}

/**
 * Validates a candidate `title-img` URL against an allowlist.
 * Returns null when the value must not be written; callers abort instead of sanitizing.
 */
export function safeTitleImgUrl(rawUrl: string): string | null {
    const url = rawUrl.trim();
    if (!url || url.length > MAX_URL_LENGTH || FORBIDDEN_CHARACTERS.test(url)) {
        return null;
    }
    if (LOCAL_ASSET_PATTERN.test(url)) {
        return url;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
        return null;
    }
    if (parsed.username || parsed.password) {
        return null;
    }
    return parsed.toString();
}

export function buildTitleImgCss(safeUrl: string): string {
    return `background-image:url("${safeUrl}");background-position:center 50%;`;
}

/** Reads the URL back out of a stored `title-img` value (used by the undo path). */
export function extractUrlFromTitleImgValue(value: string | undefined | null): string | null {
    if (!value) {
        return null;
    }
    const match = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(value);
    return match ? match[1] : null;
}

/** Attribution properties written next to `title-img` so covers stay traceable. */
export function buildAttributionAttrs(photo: UnsplashPhoto): Record<string, string> {
    return {
        "custom-unsplash-id": photo.id,
        "custom-unsplash-author": photo.user?.name ?? photo.user?.username ?? "",
        "custom-unsplash-author-url": photo.user?.links?.html ? withUtm(photo.user.links.html) : "",
        "custom-unsplash-link": photo.links?.html ? withUtm(photo.links.html) : "",
    };
}

export const ATTRIBUTION_ATTR_KEYS = [
    "custom-unsplash-id",
    "custom-unsplash-author",
    "custom-unsplash-author-url",
    "custom-unsplash-link",
] as const;

/** Validates and assembles the final `title-img` value, or throws. */
export function buildTitleImgValue(rawUrl: string): string {
    const safeUrl = safeTitleImgUrl(rawUrl);
    if (!safeUrl) {
        throw new UnsplashError("unknown", `图片地址未通过安全校验：${rawUrl.slice(0, 120)}`);
    }
    return buildTitleImgCss(safeUrl);
}
