<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { showMessage } from "siyuan";
    import PhotoGrid from "@/components/PhotoGrid.svelte";
    import { extractKeywordsFromTitle } from "@/services/keyword-extractor";
    import { searchPhotos } from "@/services/unsplash";
    import type { ApplyStage } from "@/services/banner-applier";
    import { describeError } from "@/utils/i18n";
    import type { Translate, UnsplashPhoto } from "@/types";
    import type { ConfigStore } from "@/stores/config.svelte";

    interface Props {
        docId: string;
        docTitle: string;
        configStore: ConfigStore;
        t: Translate;
        onApply: (photo: UnsplashPhoto, onStage: (stage: ApplyStage) => void) => Promise<{ degraded?: string }>;
        onApplyRandom: (query: string, onStage: (stage: ApplyStage) => void) => Promise<{ degraded?: string }>;
        onUndo: () => Promise<boolean>;
        onOpenSetting: () => void;
        onClose: () => void;
    }

    let { docId, docTitle, configStore, t, onApply, onApplyRandom, onUndo, onOpenSetting, onClose }: Props = $props();

    const PER_PAGE = 12;

    let query = $state("");
    let tokens = $state<string[]>([]);
    let photos = $state<UnsplashPhoto[]>([]);
    let page = $state(1);
    let totalPages = $state(1);
    let total = $state(0);
    let loading = $state(false);
    let errorMessage = $state("");
    let rateRemaining = $state<number | null>(null);
    let busyId = $state<string | null>(null);
    let busyStage = $state<ApplyStage | null>(null);
    let doneIds = $state<string[]>([]);
    let searched = $state(false);

    let controller: AbortController | null = null;
    let requestSeq = 0;

    const hasKey = $derived(!!configStore.current.accessKey.trim());
    const canGoPrev = $derived(page > 1 && !loading);
    const canGoNext = $derived(page < totalPages && !loading && photos.length > 0);

    async function runSearch(rawQuery: string, targetPage: number, allowFallback = true) {
        const trimmed = rawQuery.trim();
        if (!trimmed) {
            return;
        }
        controller?.abort();
        controller = new AbortController();
        const seq = ++requestSeq;

        loading = true;
        errorMessage = "";
        searched = true;

        try {
            const result = await searchPhotos(
                trimmed,
                targetPage,
                { config: configStore.current, signal: controller.signal },
                PER_PAGE,
            );
            if (seq !== requestSeq) {
                return;
            }
            const fallbackQuery = configStore.current.fallbackQuery.trim();
            if (result.data.results.length === 0 && allowFallback && fallbackQuery && fallbackQuery !== trimmed) {
                loading = false;
                showMessage(t("fallbackNotice", { query: trimmed, fallback: fallbackQuery }), 4000);
                query = fallbackQuery;
                await runSearch(fallbackQuery, 1, false);
                return;
            }
            photos = result.data.results;
            page = targetPage;
            total = result.data.total;
            totalPages = Math.max(1, Math.min(result.data.total_pages, 40));
            rateRemaining = result.rateRemaining;
        } catch (error) {
            if (seq !== requestSeq) {
                return;
            }
            photos = [];
            total = 0;
            totalPages = 1;
            errorMessage = describeError(t, error);
        } finally {
            if (seq === requestSeq) {
                loading = false;
            }
        }
    }

    function submitSearch() {
        void runSearch(query, 1);
    }

    function useToken(token: string) {
        query = token;
        void runSearch(token, 1);
    }

    async function pickPhoto(photo: UnsplashPhoto) {
        if (busyId) {
            return;
        }
        busyId = photo.id;
        busyStage = "applying";
        errorMessage = "";
        try {
            const result = await onApply(photo, (stage) => {
                busyStage = stage;
            });
            doneIds = [...doneIds.filter((id) => id !== photo.id), photo.id];
            if (result.degraded) {
                showMessage(t("warnLocalSaveFallback", { msg: result.degraded }), 6000);
            } else {
                showMessage(t("applied"), 3000);
            }
        } catch (error) {
            errorMessage = describeError(t, error);
        } finally {
            busyId = null;
            busyStage = null;
        }
    }

    async function pickRandom() {
        if (busyId) {
            return;
        }
        busyId = "random";
        busyStage = "applying";
        errorMessage = "";
        try {
            const result = await onApplyRandom(query, (stage) => {
                busyStage = stage;
            });
            if (result.degraded) {
                showMessage(t("warnLocalSaveFallback", { msg: result.degraded }), 6000);
            } else {
                showMessage(t("applied"), 3000);
            }
        } catch (error) {
            errorMessage = describeError(t, error);
        } finally {
            busyId = null;
            busyStage = null;
        }
    }

    async function undo() {
        const restored = await onUndo();
        showMessage(restored ? t("undoDone") : t("undoUnavailable"), 3000);
    }

    onMount(() => {
        if (!hasKey) {
            return;
        }
        if (!configStore.current.autoExtractTitleKeyword) {
            query = configStore.current.fallbackQuery;
            void runSearch(query, 1);
            return;
        }
        const extraction = extractKeywordsFromTitle(docTitle, configStore.current.fallbackQuery);
        tokens = extraction.tokens;
        query = extraction.primaryQuery;
        void runSearch(query, 1);
    });

    onDestroy(() => {
        controller?.abort();
    });
</script>

<div class="unsplash-picker" data-doc-id={docId}>
    {#if !hasKey}
        <div class="unsplash-empty">
            <svg class="unsplash-empty__icon"><use xlink:href="#iconImage"></use></svg>
            <div class="unsplash-empty__title">{t("notConfiguredTitle")}</div>
            <div class="unsplash-empty__desc">{t("notConfiguredDesc")}</div>
            <button class="b3-button b3-button--outline" type="button" onclick={onOpenSetting}>{t("openSetting")}</button>
        </div>
    {:else}
        <div class="unsplash-toolbar">
            <input
                class="b3-text-field fn__flex-1"
                type="text"
                placeholder={t("searchPlaceholder")}
                bind:value={query}
                onkeydown={(event) => {
                    if (event.key === "Enter") {
                        submitSearch();
                    }
                }}
            />
            <button class="b3-button b3-button--outline" type="button" onclick={submitSearch} disabled={loading}>
                {t("search")}
            </button>
            <button class="b3-button b3-button--outline" type="button" onclick={pickRandom} disabled={!!busyId}>
                {t("random")}
            </button>
            <label class="unsplash-toggle" title={t("localToggle")}>
                <input
                    type="checkbox"
                    checked={configStore.current.saveToLocalAssets}
                    onchange={(event) => configStore.update({ saveToLocalAssets: event.currentTarget.checked })}
                />
                <span>{t("localToggle")}</span>
            </label>
        </div>

        {#if tokens.length > 0}
            <div class="unsplash-tokens">
                <span class="unsplash-tokens__label">{t("tokensLabel")}</span>
                <button class="b3-chip b3-chip--pointer" type="button" onclick={() => useToken(tokens.slice(0, 3).join(" "))}>
                    {tokens.slice(0, 3).join(" + ")}
                </button>
                {#each tokens as token (token)}
                    <button class="b3-chip b3-chip--pointer" type="button" onclick={() => useToken(token)}>{token}</button>
                {/each}
            </div>
        {/if}

        <div class="unsplash-body">
            {#if loading}
                <div class="unsplash-empty">
                    <div class="unsplash-spinner"></div>
                    <div class="unsplash-empty__desc">{t("loading")}</div>
                </div>
            {:else if errorMessage}
                <div class="unsplash-empty">
                    <div class="unsplash-empty__title">{errorMessage}</div>
                    <button class="b3-button b3-button--outline" type="button" onclick={() => runSearch(query, page)}>
                        {t("search")}
                    </button>
                </div>
            {:else if searched && photos.length === 0}
                <div class="unsplash-empty">
                    <div class="unsplash-empty__title">{t("emptyResults")}</div>
                    <div class="unsplash-empty__desc">{t("emptyResultsDesc")}</div>
                </div>
            {:else}
                <PhotoGrid {photos} {busyId} {busyStage} {doneIds} {t} onpick={pickPhoto} />
            {/if}
        </div>

        <div class="unsplash-footer">
            <div class="unsplash-footer__meta">
                {#if total > 0}
                    <span>{t("total", { total })}</span>
                {/if}
                {#if rateRemaining !== null}
                    <span class="unsplash-footer__rate">{t("rateRemaining", { n: rateRemaining })}</span>
                {/if}
            </div>
            <div class="unsplash-footer__actions">
                <button class="b3-button b3-button--outline" type="button" onclick={onClose}>{t("close")}</button>
                <button class="b3-button b3-button--outline" type="button" onclick={undo}>{t("undo")}</button>
                <button
                    class="b3-button b3-button--outline"
                    type="button"
                    disabled={!canGoPrev}
                    onclick={() => runSearch(query, page - 1)}
                >{t("prev")}</button>
                <span class="unsplash-footer__page">{t("page", { page, total: totalPages })}</span>
                <button
                    class="b3-button b3-button--outline"
                    type="button"
                    disabled={!canGoNext}
                    onclick={() => runSearch(query, page + 1)}
                >{t("next")}</button>
                <a
                    class="unsplash-footer__credit"
                    href="https://unsplash.com/?utm_source=siyuan_unsplash_plugin&utm_medium=referral"
                    target="_blank"
                    rel="noopener noreferrer">{t("creditedBy")}</a
                >
            </div>
        </div>
    {/if}
</div>
