import { UnsplashError } from "@/types";
import type { PluginConfig, UnsplashPhoto, UnsplashResult, UnsplashSearchResponse } from "@/types";
import { forwardProxy, getHeader, normalizeHeaders } from "@/services/siyuan-kernel";

const API_BASE = "https://api.unsplash.com";
const ACCEPT_VERSION = "v1";
/** Search results are cached for this long; the demo key only allows 50 requests/hour. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PER_PAGE = 12;

export interface TransportResponse {
    status: number;
    body: string;
    headers: Record<string, string>;
}

/** Injectable HTTP layer; the default implementation is created by createTransport(). */
export type Transport = (url: string, headers: Record<string, string>, signal?: AbortSignal) => Promise<TransportResponse>;

export interface RequestContext {
    config: PluginConfig;
    signal?: AbortSignal;
    /** Overrides the transport, used by tests. */
    transport?: Transport;
}

interface CacheEntry {
    at: number;
    value: UnsplashResult<unknown>;
}

const responseCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<UnsplashResult<unknown>>>();

/** Test helper: drops the in-memory search cache and in-flight requests. */
export function clearUnsplashCache(): void {
    responseCache.clear();
    inflight.clear();
}

/**
 * Direct transport: the plugin runs inside the SiYuan frontend, which is same-origin
 * with api.unsplash.com only in the sense that CORS is allowed by Unsplash.
 */
export function createDirectTransport(): Transport {
    return async (url, headers, signal) => {
        let response: Response;
        try {
            response = await fetch(url, { headers, signal, mode: "cors", credentials: "omit" });
        } catch (error) {
            throw new UnsplashError("network", error instanceof Error ? error.message : String(error));
        }
        const body = await response.text();
        const plain: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            plain[key.toLowerCase()] = value;
        });
        return { status: response.status, body, headers: plain };
    };
}

export function createProxyTransport(): Transport {
    return async (url, headers) => {
        const result = await forwardProxy({ url, timeout: 15000, headers, responseEncoding: "text" });
        return { status: result.status, body: result.body, headers: normalizeHeaders(result.headers) };
    };
}

export function createTransport(config: PluginConfig): Transport {
    return config.useKernelProxy ? createProxyTransport() : createDirectTransport();
}

export function hasCJK(text: string): boolean {
    return /[\u4e00-\u9fa5]/.test(text);
}

export function buildApiUrl(endpoint: string, params: Record<string, string>): string {
    const search = new URLSearchParams(params).toString();
    return search ? `${API_BASE}${endpoint}?${search}` : `${API_BASE}${endpoint}`;
}

export function extractRateRemaining(headers: Record<string, string>): number | null {
    const raw = getHeader(headers, "x-ratelimit-remaining");
    if (raw === null) {
        return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Maps an Unsplash HTTP status onto a user-actionable error. 403 is ambiguous:
 * the API returns it both for missing permissions and for rate limiting, so the
 * body has to be inspected.
 */
export function mapErrorStatus(status: number, body: string, rateRemaining: number | null): UnsplashError {
    const snippet = body.slice(0, 300);
    if (status === 401) {
        return new UnsplashError("invalidKey", "401 Unauthorized", status, rateRemaining);
    }
    if (status === 403) {
        if (/rate\s*limit/i.test(snippet)) {
            return new UnsplashError("rateLimit", "403 Rate Limit Exceeded", status, rateRemaining);
        }
        return new UnsplashError("forbidden", "403 Forbidden", status, rateRemaining);
    }
    if (status === 404) {
        return new UnsplashError("unknown", "404 Not Found", status, rateRemaining);
    }
    return new UnsplashError("unknown", snippet || `HTTP ${status}`, status, rateRemaining);
}

function authHeaders(config: PluginConfig): Record<string, string> {
    const accessKey = config.accessKey.trim();
    if (!accessKey) {
        throw new UnsplashError("noAccessKey", "Access Key is not configured");
    }
    return {
        Authorization: `Client-ID ${accessKey}`,
        "Accept-Version": ACCEPT_VERSION,
    };
}

function parseBody<T>(body: string, status: number, rateRemaining: number | null): T {
    try {
        return JSON.parse(body) as T;
    } catch {
        throw new UnsplashError("unknown", `响应不是合法 JSON（HTTP ${status}）`, status, rateRemaining);
    }
}

export async function requestUnsplash<T>(
    endpoint: string,
    params: Record<string, string>,
    ctx: RequestContext,
): Promise<UnsplashResult<T>> {
    const headers = authHeaders(ctx.config);
    const url = buildApiUrl(endpoint, params);
    const transport = ctx.transport ?? createTransport(ctx.config);

    const response = await transport(url, headers, ctx.signal);
    const rateRemaining = extractRateRemaining(response.headers);

    if (response.status < 200 || response.status >= 300) {
        throw mapErrorStatus(response.status, response.body, rateRemaining);
    }

    return { data: parseBody<T>(response.body, response.status, rateRemaining), rateRemaining };
}

export async function searchPhotos(
    query: string,
    page: number,
    ctx: RequestContext,
    perPage = DEFAULT_PER_PAGE,
): Promise<UnsplashResult<UnsplashSearchResponse>> {
    const trimmed = query.trim();
    const params: Record<string, string> = {
        query: trimmed,
        page: String(Math.max(1, page)),
        per_page: String(perPage),
        orientation: "landscape",
    };
    if (hasCJK(trimmed)) {
        params.lang = "zh-Hans";
    }

    const cacheKey = `search:${JSON.stringify(params)}`;
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.value as UnsplashResult<UnsplashSearchResponse>;
    }

    const pending = inflight.get(cacheKey);
    if (pending) {
        return pending as Promise<UnsplashResult<UnsplashSearchResponse>>;
    }

    const request = requestUnsplash<UnsplashSearchResponse>("/search/photos", params, ctx)
        .then((result) => {
            responseCache.set(cacheKey, { at: Date.now(), value: result });
            return result;
        })
        .finally(() => {
            inflight.delete(cacheKey);
        });

    inflight.set(cacheKey, request as Promise<UnsplashResult<unknown>>);
    return request;
}

/**
 * Random landscape photo, with a fallback chain: requested query -> configured
 * fallback query -> any landscape photo. /photos/random answers 404 when a query
 * matches nothing.
 */
export async function getRandomPhoto(query: string, ctx: RequestContext): Promise<UnsplashResult<UnsplashPhoto>> {
    const candidates = [...new Set([query.trim(), ctx.config.fallbackQuery.trim(), ""])];
    let lastError: unknown = new UnsplashError("unknown", "没有可用的随机图片");

    for (const candidate of candidates) {
        const params: Record<string, string> = { orientation: "landscape" };
        if (candidate) {
            params.query = candidate;
        }
        try {
            return await requestUnsplash<UnsplashPhoto>("/photos/random", params, ctx);
        } catch (error) {
            lastError = error;
            const status = error instanceof UnsplashError ? error.status : undefined;
            // 404: no match for this query, try the next candidate.
            if (status === 404 || status === 400) {
                continue;
            }
            throw error;
        }
    }

    throw lastError;
}

/** Reports a download to Unsplash; failures must never block applying the cover. */
export async function triggerDownloadTrack(downloadLocation: string, ctx: RequestContext): Promise<void> {
    try {
        let headers: Record<string, string>;
        try {
            headers = authHeaders(ctx.config);
        } catch {
            return;
        }
        const transport = ctx.transport ?? createTransport(ctx.config);
        await transport(downloadLocation, headers);
    } catch {
        // Intentionally ignored: download tracking is best-effort.
    }
}
