/** Plugin configuration, persisted through plugin.loadData / plugin.saveData. */
export interface PluginConfig {
    /** Unsplash API Access Key. A demo key is enough (50 requests/hour). */
    accessKey: string;
    /**
     * Download the picked photo into the workspace `data/assets/` folder through the kernel API.
     * Defaults to false: referencing Unsplash's own CDN complies with the Unsplash API guidelines
     * and keeps the workspace free of duplicated files.
     */
    saveToLocalAssets: boolean;
    /** Requested cover width in pixels (imgix `w`). */
    imageWidth: ImageWidth;
    /** Requested image quality (imgix `q`). */
    imageQuality: ImageQuality;
    /** Tokenize the document title and search automatically when the picker opens. */
    autoExtractTitleKeyword: boolean;
    /** Query used when the title yields no usable keyword. */
    fallbackQuery: string;
    /** Route requests (API and images) through /api/network/forwardProxy. */
    useKernelProxy: boolean;
}

export const IMAGE_WIDTHS = [1080, 1600, 1920, 2400] as const;
export const IMAGE_QUALITIES = [60, 80, 90] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export const DEFAULT_CONFIG: PluginConfig = {
    accessKey: "",
    saveToLocalAssets: false,
    imageWidth: 1920,
    imageQuality: 80,
    autoExtractTitleKeyword: true,
    fallbackQuery: "nature landscape",
    useKernelProxy: false,
};

export interface UnsplashPhoto {
    id: string;
    description: string | null;
    alt_description: string | null;
    color: string | null;
    width: number;
    height: number;
    urls: {
        raw: string;
        full: string;
        regular: string;
        small: string;
        thumb: string;
    };
    links: {
        html: string;
        download_location: string;
    };
    user: {
        name: string;
        username: string;
        links: {
            html: string;
        };
    };
}

export interface UnsplashSearchResponse {
    total: number;
    total_pages: number;
    results: UnsplashPhoto[];
}

export interface UnsplashResult<T> {
    data: T;
    /** `X-Ratelimit-Remaining`, when the endpoint reports it. */
    rateRemaining: number | null;
}

export interface KernelEnvelope<T> {
    code: number;
    msg: string;
    data: T;
}

export class KernelError extends Error {
    constructor(
        message: string,
        public code?: number,
    ) {
        super(message);
        this.name = "KernelError";
    }
}

export type UnsplashErrorKind =
    | "noAccessKey"
    | "invalidKey"
    | "rateLimit"
    | "forbidden"
    | "network"
    | "tooLarge"
    | "uploadFailed"
    | "unknown";

/** Error surfaced to the UI; `kind` maps to an i18n key. */
export class UnsplashError extends Error {
    constructor(
        public kind: UnsplashErrorKind,
        message: string,
        public status?: number,
        public rateRemaining?: number | null,
    ) {
        super(message);
        this.name = "UnsplashError";
    }
}

/** Cached local asset per Unsplash photo id, avoids re-downloading the same photo. */
export interface AssetCacheEntry {
    path: string;
    width: number;
}

export type AssetCache = Record<string, AssetCacheEntry>;

export interface DocContext {
    docId: string;
    docTitle: string;
}

export interface TitleExtractionResult {
    /** Combined query used to prefill the search box. */
    primaryQuery: string;
    /** Individual candidate tokens, rendered as clickable pills. */
    tokens: string[];
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;
