<script lang="ts">
    import { untrack } from "svelte";
    import type { Translate } from "@/types";
    import { IMAGE_QUALITIES, IMAGE_WIDTHS } from "@/types";
    import type { ConfigStore } from "@/stores/config.svelte";
    interface Props {
        configStore: ConfigStore;
        t: Translate;
    }

    let { configStore, t }: Props = $props();

    const config = $derived(configStore.current);

    // Local mirrors of the text fields: the store is only updated on blur/change,
    // so that typing does not schedule a save per keystroke.
    let accessKey = $state(untrack(() => config.accessKey));
    let fallbackQuery = $state(untrack(() => config.fallbackQuery));

    function commitAccessKey() {
        const value = accessKey.trim();
        if (value !== config.accessKey) {
            configStore.update({ accessKey: value });
        }
    }

    function commitFallbackQuery() {
        const value = fallbackQuery.trim() || config.fallbackQuery;
        fallbackQuery = value;
        if (value !== config.fallbackQuery) {
            configStore.update({ fallbackQuery: value });
        }
    }

    function setWidth(raw: string) {
        const width = IMAGE_WIDTHS.find((item) => String(item) === raw);
        if (width !== undefined && width !== config.imageWidth) {
            configStore.update({ imageWidth: width });
        }
    }

    function setQuality(raw: string) {
        const quality = IMAGE_QUALITIES.find((item) => String(item) === raw);
        if (quality !== undefined && quality !== config.imageQuality) {
            configStore.update({ imageQuality: quality });
        }
    }
</script>

<div class="unsplash-setting">
    <div class="b3-label">
        <div class="unsplash-setting__title">{t("settingAccessKey")}</div>
        <div class="unsplash-setting__desc">{t("settingAccessKeyTip")}</div>
        <div class="unsplash-setting__row">
            <input
                class="b3-text-field fn__flex-1"
                type="password"
                spellcheck="false"
                bind:value={accessKey}
                onblur={commitAccessKey}
                onchange={commitAccessKey}
                placeholder="Client-ID"
            />
            <a
                class="b3-button b3-button--outline"
                href="https://unsplash.com/oauth/applications?utm_source=siyuan_unsplash_plugin&utm_medium=referral"
                target="_blank"
                rel="noopener noreferrer">{t("settingAccessKeyLink")}</a
            >
        </div>
    </div>

    <div class="b3-label">
        <div class="unsplash-setting__row">
            <input
                id="unsplash-setting-local"
                type="checkbox"
                checked={config.saveToLocalAssets}
                onchange={(event) => configStore.update({ saveToLocalAssets: event.currentTarget.checked })}
            />
            <label for="unsplash-setting-local" class="unsplash-setting__title">{t("settingSaveLocal")}</label>
        </div>
        <div class="unsplash-setting__desc">{t("settingSaveLocalTip")}</div>
        <div class="unsplash-setting__desc unsplash-setting__desc--warn">{t("settingSaveLocalOrphanTip")}</div>
    </div>

    <div class="b3-label">
        <div class="unsplash-setting__row">
            <span class="unsplash-setting__title">{t("settingWidth")}</span>
            <select
                class="b3-select"
                value={String(config.imageWidth)}
                onchange={(event) => setWidth(event.currentTarget.value)}
            >
                {#each IMAGE_WIDTHS as width (width)}
                    <option value={String(width)}>{width}px</option>
                {/each}
            </select>
            <span class="unsplash-setting__title">{t("settingQuality")}</span>
            <select
                class="b3-select"
                value={String(config.imageQuality)}
                onchange={(event) => setQuality(event.currentTarget.value)}
            >
                {#each IMAGE_QUALITIES as quality (quality)}
                    <option value={String(quality)}>q{quality}</option>
                {/each}
            </select>
        </div>
    </div>

    <div class="b3-label">
        <div class="unsplash-setting__row">
            <input
                id="unsplash-setting-auto-extract"
                type="checkbox"
                checked={config.autoExtractTitleKeyword}
                onchange={(event) => configStore.update({ autoExtractTitleKeyword: event.currentTarget.checked })}
            />
            <label for="unsplash-setting-auto-extract" class="unsplash-setting__title">{t("settingAutoExtract")}</label>
        </div>
        <div class="unsplash-setting__desc">{t("settingAutoExtractTip")}</div>
    </div>

    <div class="b3-label">
        <div class="unsplash-setting__title">{t("settingFallbackQuery")}</div>
        <input
            class="b3-text-field fn__block"
            type="text"
            bind:value={fallbackQuery}
            onblur={commitFallbackQuery}
            onchange={commitFallbackQuery}
        />
        <div class="unsplash-setting__desc">{t("settingFallbackQueryTip")}</div>
    </div>

    <div class="b3-label">
        <div class="unsplash-setting__row">
            <input
                id="unsplash-setting-proxy"
                type="checkbox"
                checked={config.useKernelProxy}
                onchange={(event) => configStore.update({ useKernelProxy: event.currentTarget.checked })}
            />
            <label for="unsplash-setting-proxy" class="unsplash-setting__title">{t("settingUseProxy")}</label>
        </div>
        <div class="unsplash-setting__desc">{t("settingUseProxyTip")}</div>
    </div>
</div>
