import { getActiveEditor } from "siyuan";
import { UnsplashError } from "@/types";
import type { AssetCache, DocContext, PluginConfig, UnsplashPhoto } from "@/types";
import { fetchImageBlob, getBlockAttrs, setBlockAttrs, uploadAsset } from "@/services/siyuan-kernel";
import {
    ATTRIBUTION_ATTR_KEYS,
    buildAttributionAttrs,
    buildImageUrl,
    buildTitleImgValue,
} from "@/services/title-img";
import { triggerDownloadTrack } from "@/services/unsplash";

export type ApplyStage = "downloading" | "applying";

export interface ApplyResult {
    docId: string;
    mode: "remote" | "local";
    url: string;
    /** Set when saving locally failed and the remote URL was used instead. */
    degraded?: string;
}

export interface ApplyOptions {
    onStage?: (stage: ApplyStage) => void;
    signal?: AbortSignal;
}

export interface ApplierDeps {
    getConfig(): PluginConfig;
    getAssetCache(): AssetCache;
    persistAssetCache(): Promise<void>;
}

interface UndoRecord {
    titleImg: string | null;
    attribution: Record<string, string | null>;
}

const EXTENSION_BY_MIME: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
};

export function extensionForMime(mime: string | undefined): string {
    if (!mime) {
        return "jpg";
    }
    return EXTENSION_BY_MIME[mime.split(";")[0].trim().toLowerCase()] ?? "jpg";
}

/** localFileName keeps the photo id so that re-picking the same photo can be reused. */
export function localFileName(photoId: string, mime: string | undefined): string {
    return `unsplash-${photoId}.${extensionForMime(mime)}`;
}

interface ProtyleLike {
    block?: { rootID?: string };
    title?: { editElement?: HTMLElement };
}

/** `getActiveEditor()` returns the Protyle wrapper, events hand out the inner IProtyle. */
function unwrapProtyle(input: unknown): ProtyleLike | null {
    if (!input || typeof input !== "object") {
        return null;
    }
    const candidate = input as Record<string, unknown> & { protyle?: unknown };
    if (candidate.block || candidate.title) {
        return candidate as ProtyleLike;
    }
    const inner = candidate.protyle;
    if (inner && typeof inner === "object") {
        return inner as ProtyleLike;
    }
    return null;
}

export function readTitleFromProtyle(protyle: unknown): string {
    const unwrapped = unwrapProtyle(protyle);
    const element = unwrapped?.title?.editElement;
    if (!element) {
        return "";
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value.trim();
    }
    return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function getDocIdFromProtyle(protyle: unknown): string | null {
    const unwrapped = unwrapProtyle(protyle);
    const rootId = unwrapped?.block?.rootID;
    return typeof rootId === "string" && rootId.length > 0 ? rootId : null;
}

/** Last-resort DOM lookup, used only when the editor instance cannot be resolved. */
function getDocContextFromDom(): DocContext | null {
    const selectors = [
        ".layout__wnd--active .protyle:not(.fn__none)",
        ".protyle:not(.fn__none)",
    ];
    for (const selector of selectors) {
        const element = document.querySelector<HTMLElement>(selector);
        const docId = element?.querySelector<HTMLElement>(".protyle-background[data-node-id]")?.dataset.nodeId;
        const titleElement = element?.querySelector<HTMLElement>(".protyle-title__input");
        if (docId) {
            return { docId, docTitle: (titleElement?.textContent ?? "").replace(/\s+/g, " ").trim() };
        }
    }
    return null;
}

export function getActiveDocContext(): DocContext | null {
    try {
        const editor = getActiveEditor();
        const docId = getDocIdFromProtyle(editor);
        if (docId) {
            return { docId, docTitle: readTitleFromProtyle(editor) };
        }
    } catch {
        // Fall through to the DOM lookup below.
    }
    return getDocContextFromDom();
}

export function docContextFromProtyle(protyle: unknown, titleHint?: string): DocContext | null {
    const docId = getDocIdFromProtyle(protyle);
    if (!docId) {
        return null;
    }
    const title = readTitleFromProtyle(protyle) || (titleHint ?? "");
    return { docId, docTitle: title };
}

/**
 * Applies a photo as the document cover.
 *
 * Nothing here touches the Protyle DOM: /api/attr/setBlockAttrs makes the kernel
 * push an `updateAttrs` transaction, and the frontend re-renders the background
 * (see app/src/protyle/wysiwyg/transaction.ts). Writing the DOM by hand would
 * fight with that rendering and break whenever the frontend changes.
 */
export class BannerApplier {
    private readonly undoStack = new Map<string, UndoRecord>();
    private readonly locks = new Map<string, Promise<unknown>>();

    constructor(private readonly deps: ApplierDeps) {}

    /** Serializes operations per document so rapid clicks cannot interleave writes. */
    private withLock<T>(docId: string, task: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(docId) ?? Promise.resolve();
        const next = previous.then(task, task);
        this.locks.set(
            docId,
            next.catch(() => undefined),
        );
        return next;
    }

    private async resolveLocalAsset(photo: UnsplashPhoto, config: PluginConfig, options: ApplyOptions): Promise<string> {
        const cache = this.deps.getAssetCache();
        const cached = cache[photo.id];
        if (cached && cached.width === config.imageWidth) {
            return cached.path;
        }

        options.onStage?.("downloading");
        const sourceUrl = buildImageUrl(photo, config);
        const blob = await fetchImageBlob(sourceUrl, config, options.signal);
        const fileName = localFileName(photo.id, blob.type);
        const path = await uploadAsset(blob, fileName);

        cache[photo.id] = { path, width: config.imageWidth };
        await this.deps.persistAssetCache();
        return path;
    }

    async applyPhotoToDoc(docId: string, photo: UnsplashPhoto, options: ApplyOptions = {}): Promise<ApplyResult> {
        return this.withLock(docId, async () => {
            const config = this.deps.getConfig();
            const previousAttrs = await this.safeGetAttrs(docId);

            // Best-effort download tracking, required by the Unsplash API guidelines.
            void triggerDownloadTrack(photo.links?.download_location ?? "", { config });

            let mode: ApplyResult["mode"] = "remote";
            let url = buildImageUrl(photo, config);
            let degraded: string | undefined;

            if (config.saveToLocalAssets) {
                try {
                    url = await this.resolveLocalAsset(photo, config, options);
                    mode = "local";
                } catch (error) {
                    degraded = error instanceof Error ? error.message : String(error);
                    console.warn("[unsplash-cover] saving to local assets failed, falling back to the remote URL", error);
                    if (error instanceof UnsplashError && error.kind === "noAccessKey") {
                        throw error;
                    }
                }
            }

            options.onStage?.("applying");
            const titleImg = buildTitleImgValue(url);
            const attrs: Record<string, string | null> = {
                "title-img": titleImg,
                ...buildAttributionAttrs(photo),
            };

            this.rememberUndo(docId, previousAttrs);
            await setBlockAttrs(docId, attrs);

            return { docId, mode, url, degraded };
        });
    }

    private async safeGetAttrs(docId: string): Promise<Record<string, string>> {
        try {
            return await getBlockAttrs(docId);
        } catch (error) {
            console.warn("[unsplash-cover] failed to read the previous block attributes", error);
            return {};
        }
    }

    private rememberUndo(docId: string, previousAttrs: Record<string, string>): void {
        if (this.undoStack.size >= 10) {
            const oldest = this.undoStack.keys().next().value;
            if (oldest !== undefined) {
                this.undoStack.delete(oldest);
            }
        }
        const attribution: Record<string, string | null> = {};
        for (const key of ATTRIBUTION_ATTR_KEYS) {
            attribution[key] = previousAttrs[key] ?? null;
        }
        this.undoStack.set(docId, {
            titleImg: previousAttrs["title-img"] ?? null,
            attribution,
        });
    }

    hasUndo(docId: string): boolean {
        return this.undoStack.has(docId);
    }

    /** Restores the cover that was in place before the last apply. */
    async undoLastApply(docId: string): Promise<boolean> {
        const record = this.undoStack.get(docId);
        if (!record) {
            return false;
        }
        return this.withLock(docId, async () => {
            await setBlockAttrs(docId, { "title-img": record.titleImg, ...record.attribution });
            this.undoStack.delete(docId);
            return true;
        });
    }
}
