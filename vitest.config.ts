import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(import.meta.dirname, "src"),
            // The siyuan package cannot be resolved outside the SiYuan frontend.
            siyuan: resolve(import.meta.dirname, "tests/stubs/siyuan.ts"),
        },
    },
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
});
