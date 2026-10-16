import type { Plugin } from "siyuan";
import { DEFAULT_CONFIG, IMAGE_QUALITIES, IMAGE_WIDTHS } from "@/types";
import type { AssetCache, ImageQuality, ImageWidth, PluginConfig } from "@/types";

export const STORAGE_NAME = "unsplash-cover-config.json";
export const ASSET_CACHE_STORAGE_NAME = "unsplash-cover-assets.json";

/** loadData/saveData can never settle on some kernel error codes, so guard with a timeout. */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
                timer = setTimeout(() => resolve(fallback), ms);
            }),
        ]);
    } catch {
        return fallback;
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

function pickEnum<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    return allowed.includes(parsed as T) ? (parsed as T) : fallback;
}

/** Merges persisted data onto the defaults, defending against hand-edited files. */
export function normalizeConfig(raw: unknown): PluginConfig {
    if (!raw || typeof raw !== "object") {
        return { ...DEFAULT_CONFIG };
    }
    const source = raw as Record<string, unknown>;
    const fallbackQuery =
        typeof source.fallbackQuery === "string" && source.fallbackQuery.trim()
            ? source.fallbackQuery.trim()
            : DEFAULT_CONFIG.fallbackQuery;
    return {
        accessKey: typeof source.accessKey === "string" ? source.accessKey.trim() : DEFAULT_CONFIG.accessKey,
        saveToLocalAssets: source.saveToLocalAssets === true,
        imageWidth: pickEnum<ImageWidth>(source.imageWidth, IMAGE_WIDTHS, DEFAULT_CONFIG.imageWidth),
        imageQuality: pickEnum<ImageQuality>(source.imageQuality, IMAGE_QUALITIES, DEFAULT_CONFIG.imageQuality),
        autoExtractTitleKeyword: source.autoExtractTitleKeyword !== false,
        fallbackQuery,
        useKernelProxy: source.useKernelProxy === true,
    };
}

export async function loadConfig(plugin: Plugin): Promise<PluginConfig> {
    const saved = await withTimeout(plugin.loadData(STORAGE_NAME), 4000, null);
    return normalizeConfig(saved);
}

export async function saveConfig(plugin: Plugin, config: PluginConfig): Promise<void> {
    await withTimeout(plugin.saveData(STORAGE_NAME, config), 4000, undefined);
}

export async function loadAssetCache(plugin: Plugin): Promise<AssetCache> {
    const saved = await withTimeout(plugin.loadData(ASSET_CACHE_STORAGE_NAME), 4000, null);
    if (!saved || typeof saved !== "object") {
        return {};
    }
    const cache: AssetCache = {};
    for (const [photoId, entry] of Object.entries(saved as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const { path, width } = entry as Record<string, unknown>;
        if (typeof path === "string" && path.startsWith("assets/")) {
            cache[photoId] = { path, width: typeof width === "number" ? width : 0 };
        }
    }
    return cache;
}

export async function saveAssetCache(plugin: Plugin, cache: AssetCache): Promise<void> {
    await withTimeout(plugin.saveData(ASSET_CACHE_STORAGE_NAME, cache), 4000, undefined);
}
