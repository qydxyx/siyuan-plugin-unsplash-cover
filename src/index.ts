import { Dialog, Plugin, Setting, getFrontend, showMessage } from "siyuan";
import type { IProtyle, subMenu } from "siyuan";
import { mount, unmount } from "svelte";

import UnsplashPicker from "@/components/UnsplashPicker.svelte";
import SettingPanel from "@/components/SettingPanel.svelte";
import { BannerApplier, docContextFromProtyle, getActiveDocContext } from "@/services/banner-applier";
import type { ApplyStage } from "@/services/banner-applier";
import { loadAssetCache, loadConfig, saveAssetCache } from "@/services/config";
import { extractKeywordsFromTitle } from "@/services/keyword-extractor";
import { getRandomPhoto } from "@/services/unsplash";
import { createConfigStore } from "@/stores/config.svelte";
import type { ConfigStore } from "@/stores/config.svelte";
import { createTranslate, describeError, normalizeI18n } from "@/utils/i18n";
import type { AssetCache, DocContext, Translate, UnsplashPhoto } from "@/types";
import "@/index.scss";

/** Name used when the key is provided through SiYuan's secret store. */
const SECRET_NAME = "unsplash_access_key";

interface TitleIconDetail {
    menu: subMenu;
    protyle: IProtyle;
    data?: { rootID?: string; name?: string };
}

export default class UnsplashCoverPlugin extends Plugin {
    private configStore!: ConfigStore;
    private applier!: BannerApplier;
    private assetCache: AssetCache = {};
    private t: Translate = (key) => key;
    private isMobile = false;

    private pickerDialog: Dialog | null = null;
    private pickerApp: ReturnType<typeof mount> | null = null;
    private settingDialog: Dialog | null = null;
    private settingApp: ReturnType<typeof mount> | null = null;

    override async onload() {
        this.isMobile = getFrontend().includes("mobile");
        this.t = createTranslate(normalizeI18n(this.i18n));

        const config = await loadConfig(this);
        const secret = this.readSecret();
        if (secret && !config.accessKey) {
            config.accessKey = secret;
        }
        this.configStore = createConfigStore(this, config);
        this.assetCache = await loadAssetCache(this);
        this.applier = new BannerApplier({
            getConfig: () => this.configStore.current,
            getAssetCache: () => this.assetCache,
            persistAssetCache: () => saveAssetCache(this, this.assetCache),
        });

        this.eventBus.on("click-editortitleicon", this.onTitleIconClick);
        this.addTopBar({
            id: "unsplash-cover",
            icon: "iconImage",
            title: this.t("toolbarTooltip"),
            callback: () => this.openPickerForActiveDoc(),
        });
        this.addCommand({
            langKey: "cmdOpenPicker",
            hotkey: "",
            editorCallback: (protyle) => this.openPickerFromProtyle(protyle),
            callback: () => this.openPickerForActiveDoc(),
        });
        this.addCommand({
            langKey: "cmdRandomCover",
            hotkey: "",
            editorCallback: (protyle) => void this.randomCoverFromProtyle(protyle),
            callback: () => void this.randomCoverForActiveDoc(),
        });

        this.setupNativeSettingEntry();
    }

    override onunload() {
        this.eventBus.off("click-editortitleicon", this.onTitleIconClick);
        this.configStore.flush();
        this.pickerDialog?.destroy();
        this.settingDialog?.destroy();
    }

    /**
     * Must be overridden: when this hook is absent SiYuan reloads the entire plugin
     * for every petal write. Because onunload() flushes the configuration, such a
     * reload writes the petal file again and the plugin ends up reloading itself in
     * a loop (the toolbar entry flickers). Changes from another frontend are picked
     * up by re-reading the files instead of reloading.
     */
    override async onDataChanged(reason?: string) {
        if (reason !== "sync" && reason !== "overwrite") {
            return;
        }
        try {
            const config = await loadConfig(this);
            const secret = this.readSecret();
            if (secret && !config.accessKey) {
                config.accessKey = secret;
            }
            this.configStore.applyExternal(config);
            this.assetCache = await loadAssetCache(this);
        } catch (error) {
            console.warn("[unsplash-cover] failed to refresh the configuration after an external change", error);
        }
    }

    override async uninstall() {
        await this.removeData("unsplash-cover-config.json");
        await this.removeData("unsplash-cover-assets.json");
    }

    override openSetting() {
        this.openSettingDialog();
    }

    /**
     * Reads the Access Key from SiYuan's encrypted secret store when available.
     * Falls back silently: the API only exists on newer kernels.
     */
    private readSecret(): string {
        try {
            if (typeof this.getSecret !== "function") {
                return "";
            }
            return (this.getSecret(SECRET_NAME) ?? "").trim();
        } catch {
            return "";
        }
    }

    /** Registers a native setting panel whose only item opens the plugin's own dialog. */
    private setupNativeSettingEntry() {
        try {
            this.setting = new Setting({
                height: "120px",
                confirmCallback: () => this.configStore.flush(),
            });
            const button = document.createElement("button");
            button.className = "b3-button b3-button--outline";
            button.textContent = this.t("openSetting");
            button.addEventListener("click", () => this.openSettingDialog());
            this.setting.addItem({
                title: this.t("settingTitle"),
                description: this.t("settingAccessKeyTip"),
                actionElement: button,
            });
        } catch (error) {
            console.warn("[unsplash-cover] native setting entry is unavailable", error);
        }
    }

    private onTitleIconClick = (event: Event) => {
        const detail = (event as CustomEvent<TitleIconDetail>).detail;
        if (!detail?.menu) {
            return;
        }
        const docId = detail.data?.rootID ?? detail.protyle?.block?.rootID ?? "";
        const docTitle = detail.data?.name ?? "";
        detail.menu.addItem({
            icon: "iconImage",
            label: this.t("cmdOpenPicker"),
            click: () => {
                this.openPickerDialog({ docId, docTitle, protyle: detail.protyle });
            },
        });
        detail.menu.addItem({
            icon: "iconRefresh",
            label: this.t("cmdRandomCover"),
            click: () => {
                const context = docContextFromProtyle(detail.protyle, docTitle) ?? {
                    docId,
                    docTitle,
                };
                if (context.docId) {
                    void this.randomCover(context);
                }
            },
        });
    };

    private openPickerForActiveDoc() {
        const context = getActiveDocContext();
        if (!context) {
            showMessage(this.t("errorUnknown", { msg: "-" }), 4000, "error");
            return;
        }
        this.openPickerDialog(context);
    }

    private openPickerFromProtyle(protyle: IProtyle) {
        const context = docContextFromProtyle(protyle);
        if (!context) {
            this.openPickerForActiveDoc();
            return;
        }
        this.openPickerDialog({ ...context, protyle });
    }

    private openPickerDialog(options: DocContext & { protyle?: IProtyle }) {
        this.pickerDialog?.destroy();
        const dialog = new Dialog({
            title: this.t("pickerTitle"),
            content: `<div class="unsplash-dialog-container"></div>`,
            width: this.isMobile ? "92vw" : "860px",
            height: this.isMobile ? "82vh" : "640px",
            destroyCallback: () => {
                if (this.pickerApp) {
                    void unmount(this.pickerApp);
                    this.pickerApp = null;
                }
                if (this.pickerDialog === dialog) {
                    this.pickerDialog = null;
                }
            },
        });
        this.pickerDialog = dialog;

        const target = dialog.element.querySelector<HTMLElement>(".unsplash-dialog-container");
        if (!target) {
            return;
        }

        this.pickerApp = mount(UnsplashPicker, {
            target,
            props: {
                docId: options.docId,
                docTitle: options.docTitle,
                configStore: this.configStore,
                t: this.t,
                onApply: async (photo: UnsplashPhoto, onStage: (stage: ApplyStage) => void) => {
                    return await this.applier.applyPhotoToDoc(options.docId, photo, { onStage });
                },
                onApplyRandom: async (query: string, onStage: (stage: ApplyStage) => void) => {
                    return await this.applyRandomPhoto(options.docId, query, onStage);
                },
                onUndo: () => this.applier.undoLastApply(options.docId),
                onOpenSetting: () => {
                    dialog.destroy();
                    this.openSettingDialog();
                },
                onClose: () => dialog.destroy(),
            },
        });
    }

    private openSettingDialog() {
        if (this.settingDialog) {
            return;
        }
        const dialog = new Dialog({
            title: this.t("settingTitle"),
            content: `<div class="unsplash-setting-container"></div>`,
            width: this.isMobile ? "92vw" : "680px",
            height: this.isMobile ? "82vh" : "620px",
            destroyCallback: () => {
                if (this.settingApp) {
                    void unmount(this.settingApp);
                    this.settingApp = null;
                }
                if (this.settingDialog === dialog) {
                    this.settingDialog = null;
                }
            },
        });
        this.settingDialog = dialog;

        const target = dialog.element.querySelector<HTMLElement>(".unsplash-setting-container");
        if (!target) {
            return;
        }
        this.settingApp = mount(SettingPanel, {
            target,
            props: { configStore: this.configStore, t: this.t },
        });
    }

    private async randomCoverForActiveDoc() {
        const context = getActiveDocContext();
        if (!context) {
            showMessage(this.t("errorUnknown", { msg: "-" }), 4000, "error");
            return;
        }
        await this.randomCover(context);
    }

    private async randomCoverFromProtyle(protyle: IProtyle) {
        const context = docContextFromProtyle(protyle);
        if (!context) {
            await this.randomCoverForActiveDoc();
            return;
        }
        await this.randomCover(context);
    }

    private async randomCover(context: DocContext) {
        showMessage(this.t("loading"), 8000);
        try {
            const result = await this.applyRandomPhoto(context.docId, context.docTitle);
            if (result.degraded) {
                showMessage(this.t("warnLocalSaveFallback", { msg: result.degraded }), 6000);
            } else {
                showMessage(this.t("applied"), 3000);
            }
        } catch (error) {
            showMessage(describeError(this.t, error), 6000, "error");
        }
    }

    private async applyRandomPhoto(docId: string, query: string, onStage?: (stage: ApplyStage) => void) {
        const config = this.configStore.current;
        const extraction = extractKeywordsFromTitle(query || "", config.fallbackQuery);
        const result = await getRandomPhoto(extraction.primaryQuery, { config });
        return await this.applier.applyPhotoToDoc(docId, result.data, { onStage });
    }
}
