import type { Plugin } from "siyuan";
import { saveConfig } from "@/services/config";
import type { PluginConfig } from "@/types";

export interface ConfigStore {
    /** Reactive snapshot of the current configuration. */
    readonly current: PluginConfig;
    /** Merges a patch and schedules a save. */
    update(patch: Partial<PluginConfig>): void;
    /** Replaces the whole configuration and saves immediately. */
    replace(next: PluginConfig): Promise<void>;
    /** Replaces the configuration coming from another frontend, without saving it back. */
    applyExternal(next: PluginConfig): void;
    /** Writes a pending change right now; does nothing when there is none. */
    flush(): void;
}

function createDebouncedSave(plugin: Plugin, read: () => PluginConfig) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;

    const clearTimer = () => {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
    };

    /**
     * Only writes when something actually changed.
     *
     * An unconditional write here is dangerous: SiYuan broadcasts a plugin data
     * change for every petal write, and the plugin is reloaded for it, which calls
     * onunload() -> flush() again. Writing on every unload therefore produced an
     * endless reload loop (the toolbar icon flickered several times per second).
     */
    const write = () => {
        clearTimer();
        if (!dirty) {
            return;
        }
        dirty = false;
        void saveConfig(plugin, read()).catch((error) => {
            console.warn("[unsplash-cover] failed to save the configuration", error);
        });
    };

    return {
        schedule() {
            dirty = true;
            clearTimer();
            timer = setTimeout(write, 300);
        },
        flush: write,
        // An external write already landed on disk; nothing to persist.
        markClean() {
            dirty = false;
            clearTimer();
        },
    };
}

/**
 * Shared reactive configuration.
 *
 * Components never mutate the config object they receive: they go through the
 * store, which both triggers reactivity and persists the change.
 */
export function createConfigStore(plugin: Plugin, initial: PluginConfig): ConfigStore {
    let value = $state<PluginConfig>({ ...initial });
    const saver = createDebouncedSave(plugin, () => $state.snapshot(value) as PluginConfig);

    return {
        get current() {
            return value;
        },
        update(patch: Partial<PluginConfig>) {
            Object.assign(value, patch);
            saver.schedule();
        },
        async replace(next: PluginConfig) {
            value = { ...next };
            await saveConfig(plugin, $state.snapshot(value) as PluginConfig);
            saver.markClean();
        },
        applyExternal(next: PluginConfig) {
            value = { ...next };
            saver.markClean();
        },
        flush() {
            saver.flush();
        },
    };
}
