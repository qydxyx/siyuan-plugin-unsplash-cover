import { fetchSyncPost } from "siyuan";
import { KernelError, UnsplashError } from "@/types";
import type { PluginConfig } from "@/types";

/**
 * Thin wrapper around the SiYuan kernel API.
 *
 * Everything the plugin needs from the kernel goes through here so that a kernel
 * change only has to be fixed in one place. `fetchSyncPost` is used instead of a
 * bare `fetch` because it attaches the app identifier and handles the workspace
 * access-authorization-code case.
 */

/** Kernel responses are `{code: 0, ...}` on success and `{code: <0>, ...}` on failure. */
interface AnyEnvelope {
    code: number;
    msg: string;
    data: unknown;
}

function unwrap<T>(response: AnyEnvelope | undefined, path: string): T {
    if (!response || typeof response.code !== "number") {
        throw new KernelError(`内核接口 ${path} 返回异常`);
    }
    if (response.code !== 0) {
        throw new KernelError(response.msg || `内核接口 ${path} 调用失败`, response.code);
    }
    return response.data as T;
}

/**
 * Uploads a blob into the workspace assets folder.
 * `assetsDirPath` is relative to the workspace data folder, hence `/assets/`.
 */
export async function uploadAsset(blob: Blob, fileName: string): Promise<string> {
    const formData = new FormData();
    formData.append("assetsDirPath", "/assets/");
    formData.append("file[]", new File([blob], fileName, { type: blob.type || "image/jpeg" }));

    // The published APIFormData type only adds a phantom brand to FormData, so the
    // branded type cannot be constructed by a plugin; the runtime value is correct.
    const response = await fetchSyncPost("/api/asset/upload", formData as never);
    if (response.code !== 0) {
        throw new UnsplashError("uploadFailed", response.msg || "内核返回上传失败");
    }

    const data = response.data;
    const path = data?.succFiles?.[0]?.path || data?.succMap?.[fileName];
    if (!path) {
        throw new UnsplashError("uploadFailed", "上传结果中没有资源路径");
    }
    return path;
}

export async function setBlockAttrs(id: string, attrs: Record<string, string | null>): Promise<void> {
    const response = await fetchSyncPost("/api/attr/setBlockAttrs", { id, attrs });
    unwrap<null>(response, "/api/attr/setBlockAttrs");
}

export async function getBlockAttrs(id: string): Promise<Record<string, string>> {
    const response = await fetchSyncPost("/api/attr/getBlockAttrs", { id });
    return unwrap<Record<string, string>>(response, "/api/attr/getBlockAttrs") ?? {};
}

export interface ForwardProxyResult {
    status: number;
    body: string;
    bodyEncoding: "text" | "base64";
    headers: Record<string, string>;
}

export interface ForwardProxyOptions {
    url: string;
    method?: string;
    timeout?: number;
    headers?: Record<string, string>;
    responseEncoding?: "text" | "base64";
}

/**
 * Calls /api/network/forwardProxy and unpacks both layers: the kernel envelope
 * (`code`) and the upstream response (`data.status` / `data.body` / `data.headers`).
 */
export async function forwardProxy(options: ForwardProxyOptions): Promise<ForwardProxyResult> {
    const response = await fetchSyncPost("/api/network/forwardProxy", {
        url: options.url,
        method: options.method ?? "GET",
        timeout: options.timeout ?? 15000,
        contentType: "application/json",
        headers: [options.headers ?? {}],
        redirect: true,
        responseEncoding: options.responseEncoding ?? "text",
    });

    if (response.code === 10) {
        // The kernel refuses bodies above 32 MiB without returning a partial body.
        throw new UnsplashError("tooLarge", response.msg || "响应体超过内核代理上限");
    }
    if (response.code !== 0) {
        throw new KernelError(response.msg || "内核代理请求失败", response.code);
    }

    const data = response.data;
    return {
        status: data?.status ?? 0,
        body: data?.body ?? "",
        bodyEncoding: data?.bodyEncoding === "base64" ? "base64" : "text",
        headers: normalizeHeaders(data?.headers),
    };
}

/** Header names are case-insensitive and the kernel may return either casing. */
export function normalizeHeaders(headers: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (headers && typeof headers === "object" && !Array.isArray(headers)) {
        for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
            const normalized = normalizeHeaderValue(value);
            if (normalized !== null) {
                result[key.toLowerCase()] = normalized;
            }
        }
    }
    return result;
}

function normalizeHeaderValue(value: unknown): string | null {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value) && value.length > 0) {
        return normalizeHeaderValue(value[0]);
    }
    return null;
}

export function getHeader(headers: Record<string, string>, name: string): string | null {
    const lower = name.toLowerCase();
    const direct = headers[lower];
    if (direct !== undefined) {
        return direct;
    }
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lower) {
            return value;
        }
    }
    return null;
}

/** Base64 (optionally a data URL) to Blob, used when images come back through the proxy. */
export function base64ToBlob(body: string, contentType = "image/jpeg"): Blob {
    const comma = body.indexOf(",");
    const payload = body.startsWith("data:") && comma > -1 ? body.slice(comma + 1) : body;
    const binary = atob(payload.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: contentType });
}

/**
 * Fetches an image either directly or through the kernel proxy.
 * The proxy path is required for users on restricted networks, where the direct
 * request to images.unsplash.com fails even though the API is reachable.
 */
export async function fetchImageBlob(
    url: string,
    config: Pick<PluginConfig, "useKernelProxy">,
    signal?: AbortSignal,
): Promise<Blob> {
    if (config.useKernelProxy) {
        const result = await forwardProxy({ url, responseEncoding: "base64", timeout: 30000 });
        if (result.status < 200 || result.status >= 300) {
            throw new UnsplashError("network", `图片下载失败（HTTP ${result.status}）`, result.status);
        }
        const contentType = getHeader(result.headers, "content-type") ?? "image/jpeg";
        return base64ToBlob(result.body, contentType.split(";")[0]);
    }

    let response: Response;
    try {
        response = await fetch(url, { signal, mode: "cors", credentials: "omit" });
    } catch (error) {
        throw new UnsplashError("network", error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) {
        throw new UnsplashError("network", `图片下载失败（HTTP ${response.status}）`, response.status);
    }
    return await response.blob();
}
