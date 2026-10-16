import { resolve } from "node:path";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import zipPack from "vite-plugin-zip-pack";

const isDev = process.env.NODE_ENV === "development";
const isSrcmap = process.env.VITE_SOURCEMAP === "inline";
const outputDir = isDev ? "dev" : "dist";

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(import.meta.dirname, "src"),
        },
    },
    // public/ (i18n, icon.png, preview.png) is mirrored by Vite's publicDir copy;
    // the root-level files are added here.
    plugins: [
        svelte(),
        viteStaticCopy({
            targets: [
                { src: "plugin.json", dest: "./" },
                { src: "README.md", dest: "./" },
                { src: "README_zh_CN.md", dest: "./" },
            ],
        }),
        ...(isDev
            ? []
            : [
                  zipPack({
                      inDir: "./dist",
                      outDir: "./",
                      outFileName: "package.zip",
                  }),
              ]),
    ],
    build: {
        outDir: outputDir,
        emptyOutDir: true,
        minify: !isDev,
        sourcemap: isSrcmap ? "inline" : false,
        cssCodeSplit: false,
        lib: {
            entry: resolve(import.meta.dirname, "src/index.ts"),
            name: "SiYuanUnsplashCover",
            formats: ["cjs"],
            fileName: () => "index.js",
        },
        rollupOptions: {
            external: ["siyuan"],
            output: {
                entryFileNames: "index.js",
                chunkFileNames: "chunks/[name].js",
                assetFileNames: (assetInfo) => (assetInfo.name?.endsWith(".css") ? "index.css" : "[name][extname]"),
            },
        },
    },
});
