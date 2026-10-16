/*
 * Adapted from siyuan-note/plugin-sample-vite-svelte (MIT, (c) frostime).
 * Copies dist/ into {workspace}/data/plugins/<plugin name>.
 *
 * Usage: pnpm run make-install [-- /path/to/data/plugins]
 */
import fs from "node:fs";
import { copyDirectory, error, getThisPluginName, log, resolveTargetDir } from "./utils.js";

const targetDir = await resolveTargetDir(process.argv[2]);

if (!targetDir) {
    process.exit(1);
}
if (!fs.existsSync(targetDir)) {
    error(`Failed! Plugin directory not exists: "${targetDir}"`);
    process.exit(1);
}

const distDir = `${process.cwd()}/dist`;
if (!fs.existsSync(distDir)) {
    error(`Failed! Build output "${distDir}" not found. Run "pnpm run build" first.`);
    process.exit(1);
}

const name = getThisPluginName();
if (name === null) {
    process.exit(1);
}

log(`>>> Installing "${name}" to ${targetDir}`);
copyDirectory(distDir, `${targetDir}/${name}`);
