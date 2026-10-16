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
    /** Writes any pending change right now (used from onunload). */
    flush(): void;
}

function createDebouncedSave(plugin: Plugin, read: () => PluginConfig) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = () => {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        void saveConfig(plugin, read()).catch((error) => {
            console.warn("[unsplash-cover] failed to save the configuration", error);
        });
    };
    return {
        schedule() {
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(write, 300);
        },
        flush: write,
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
        },
        flush() {
            saver.flush();
        },
    };
}
