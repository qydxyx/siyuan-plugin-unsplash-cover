import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchSyncPost } from "siyuan";
import { DEFAULT_CONFIG, KernelError, UnsplashError } from "@/types";
import type { PluginConfig, UnsplashPhoto, UnsplashSearchResponse } from "@/types";

const { forwardProxy, fetchImageBlob, normalizeHeaders } = await import("@/services/siyuan-kernel");
const { clearUnsplashCache, extractRateRemaining, mapErrorStatus, getRandomPhoto, searchPhotos } = await import(
    "@/services/unsplash"
);
type Transport = import("@/services/unsplash").Transport;

const config: PluginConfig = { ...DEFAULT_CONFIG, accessKey: "key" };
const proxyConfig: PluginConfig = { ...config, useKernelProxy: true };

/** `fetchSyncPost` is aliased to tests/stubs/siyuan.ts by vitest, but tsc sees the real package types. */
const mockFetchSyncPost = fetchSyncPost as unknown as {
    mockReset(): void;
    mockResolvedValue(value: unknown): void;
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return { status, body: JSON.stringify(body), headers };
}

function photo(id: string): UnsplashPhoto {
    return {
        id,
        description: null,
        alt_description: null,
        color: null,
        width: 100,
        height: 100,
        urls: { raw: `https://images.unsplash.com/${id}`, full: "", regular: "", small: "", thumb: "" },
        links: { html: `https://unsplash.com/photos/${id}`, download_location: `https://api.unsplash.com/${id}/download` },
        user: { name: "A", username: "a", links: { html: "https://unsplash.com/@a" } },
    };
}

function searchPayload(ids: string[]): UnsplashSearchResponse {
    return { total: ids.length, total_pages: 1, results: ids.map(photo) };
}

beforeEach(() => {
    clearUnsplashCache();
    mockFetchSyncPost.mockReset();
});

afterEach(() => {
    clearUnsplashCache();
});

describe("error mapping", () => {
    it("maps 401 to invalidKey", () => {
        expect(mapErrorStatus(401, "{}", null).kind).toBe("invalidKey");
    });

    it("maps 403 with a rate-limit body to rateLimit", () => {
        const error = mapErrorStatus(403, '{"errors":["Rate Limit Exceeded"]}', 0);
        expect(error.kind).toBe("rateLimit");
        expect(error.rateRemaining).toBe(0);
    });

    it("maps other 403 responses to forbidden", () => {
        expect(mapErrorStatus(403, '{"errors":["Forbidden"]}', 42).kind).toBe("forbidden");
    });

    it("refuses to call the API without an access key", async () => {
        await expect(searchPhotos("cat", 1, { config: { ...config, accessKey: " " } })).rejects.toMatchObject({
            kind: "noAccessKey",
        });
    });
});

describe("rate limit headers", () => {
    it("reads remaining requests regardless of header casing", () => {
        expect(extractRateRemaining({ "x-ratelimit-remaining": "12" })).toBe(12);
        expect(extractRateRemaining({ "X-RateLimit-Remaining": "7" })).toBe(7);
        expect(extractRateRemaining({})).toBeNull();
        expect(extractRateRemaining({ "x-ratelimit-remaining": "abc" })).toBeNull();
    });

    it("normalizes kernel proxy headers", () => {
        expect(normalizeHeaders({ "Content-Type": "image/jpeg", "X-Ratelimit-Remaining": 5 })).toEqual({
            "content-type": "image/jpeg",
            "x-ratelimit-remaining": "5",
        });
    });
});

describe("searchPhotos", () => {
    it("requests landscape images and asks for Chinese results for CJK queries", async () => {
        const calls: string[] = [];
        const transport: Transport = async (url) => {
            calls.push(url);
            return jsonResponse(searchPayload(["a"]), 200, { "x-ratelimit-remaining": "42" });
        };

        const result = await searchPhotos("秋日露营", 1, { config, transport });
        const url = new URL(calls[0]);
        expect(url.pathname).toBe("/search/photos");
        expect(url.searchParams.get("orientation")).toBe("landscape");
        expect(url.searchParams.get("lang")).toBe("zh-Hans");
        expect(url.searchParams.get("per_page")).toBe("12");
        expect(result.rateRemaining).toBe(42);

        calls.length = 0;
        await searchPhotos("autumn camping", 1, { config, transport });
        expect(new URL(calls[0]).searchParams.get("lang")).toBeNull();
    });

    it("caches identical searches and dedupes concurrent ones", async () => {
        let requests = 0;
        const transport: Transport = async () => {
            requests += 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            return jsonResponse(searchPayload(["a", "b"]));
        };

        await searchPhotos("cat", 1, { config, transport });
        await searchPhotos("cat", 1, { config, transport });
        expect(requests).toBe(1);

        await Promise.all([
            searchPhotos("dog", 2, { config, transport }),
            searchPhotos("dog", 2, { config, transport }),
        ]);
        expect(requests).toBe(2);
    });

    it("propagates mapped errors", async () => {
        const transport: Transport = async () => ({ status: 403, body: '{"errors":["Rate Limit Exceeded"]}', headers: {} });
        await expect(searchPhotos("cat", 1, { config, transport })).rejects.toBeInstanceOf(UnsplashError);
    });
});

describe("getRandomPhoto", () => {
    it("falls back when the query has no match", async () => {
        const requested: string[] = [];
        const transport: Transport = async (url) => {
            const query = new URL(url).searchParams.get("query") ?? "";
            requested.push(query);
            if (query !== "nature landscape") {
                return { status: 404, body: "{}", headers: {} };
            }
            return jsonResponse(photo("found"));
        };

        const result = await getRandomPhoto("未知主题", { config, transport });
        expect(result.data.id).toBe("found");
        expect(requested).toEqual(["未知主题", "nature landscape"]);
    });

    it("retries without a query when every query fails", async () => {
        const requested: (string | null)[] = [];
        const transport: Transport = async (url) => {
            const query = new URL(url).searchParams.get("query");
            requested.push(query);
            return query === null ? jsonResponse(photo("any")) : { status: 404, body: "{}", headers: {} };
        };

        const result = await getRandomPhoto("秋日露营", { config, transport });
        expect(result.data.id).toBe("any");
        expect(requested.at(-1)).toBeNull();
    });
});

describe("kernel proxy transport", () => {
    it("unpacks the envelope and the upstream status", async () => {
        mockFetchSyncPost.mockResolvedValue({
            code: 0,
            msg: "",
            data: { status: 200, body: "{}", bodyEncoding: "text", headers: { "X-Ratelimit-Remaining": "40" } },
        });

        const result = await forwardProxy({ url: "https://api.unsplash.com/search/photos" });
        expect(result.status).toBe(200);
        expect(result.headers["x-ratelimit-remaining"]).toBe("40");
        expect(fetchSyncPost).toHaveBeenCalledWith(
            "/api/network/forwardProxy",
            expect.objectContaining({ url: "https://api.unsplash.com/search/photos", headers: [expect.any(Object)] }),
        );
    });

    it("surfaces the kernel envelope error code", async () => {
        mockFetchSyncPost.mockResolvedValue({ code: -1, msg: "boom", data: null });
        await expect(forwardProxy({ url: "https://api.unsplash.com" })).rejects.toBeInstanceOf(KernelError);
    });

    it("maps the 32 MiB body limit to a user-facing error", async () => {
        mockFetchSyncPost.mockResolvedValue({ code: 10, msg: "too large", data: null });
        await expect(forwardProxy({ url: "https://images.unsplash.com/x" })).rejects.toMatchObject({ kind: "tooLarge" });
    });

    it("downloads images through the proxy when enabled", async () => {
        const payload = Buffer.from("hello").toString("base64");
        mockFetchSyncPost.mockResolvedValue({
            code: 0,
            msg: "",
            data: { status: 200, body: payload, bodyEncoding: "base64", headers: { "Content-Type": "image/jpeg" } },
        });

        const blob = await fetchImageBlob("https://images.unsplash.com/x", proxyConfig);
        expect(blob.type).toBe("image/jpeg");
        expect(await blob.text()).toBe("hello");
        expect(fetchSyncPost).toHaveBeenCalledWith("/api/network/forwardProxy", expect.objectContaining({ responseEncoding: "base64" }));
    });
});
