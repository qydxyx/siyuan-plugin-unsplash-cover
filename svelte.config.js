import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const SuppressedWarnings = new Set([
    "a11y_click_events_have_key_events",
    "a11y_no_static_element_interactions",
    "a11y_no_noninteractive_element_interactions",
]);

export default {
    preprocess: vitePreprocess(),
    onwarn: (warning, handler) => {
        if (SuppressedWarnings.has(warning.code)) {
            return;
        }
        handler(warning);
    },
};
