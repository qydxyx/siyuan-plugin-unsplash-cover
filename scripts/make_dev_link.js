/*
 * Adapted from siyuan-note/plugin-sample-vite-svelte (MIT, (c) frostime).
 * Links the build output (dev/ by default) into {workspace}/data/plugins/<plugin name>.
 *
 * Usage:
 *   pnpm run make-link                        # auto-detect workspace (SiYuan must be running)
 *   pnpm run make-link -- /path/to/data/plugins
 *   SIYUAN_PLUGIN_DIR=/path/to/data/plugins pnpm run make-link
 */
import fs from "node:fs";
import { error, getThisPluginName, log, makeSymbolicLink, resolveTargetDir } from "./utils.js";

const targetDir = await resolveTargetDir(process.argv[2]);

if (!targetDir) {
    process.exit(1);
}
if (!fs.existsSync(targetDir)) {
    error(`Failed! Plugin directory not exists: "${targetDir}"`);
    process.exit(1);
}

const name = getThisPluginName();
if (name === null) {
    process.exit(1);
}

const devDir = `${process.cwd()}/dev`;
if (!fs.existsSync(devDir)) {
    // Build once so the link target exists and the log is not misleading.
    error(`Build output directory "${devDir}" does not exist yet.`);
    error('Please run "pnpm run dev" (or a one-off "vite build --mode development") first.');
    process.exit(1);
}

log(`>>> Plugin name: ${name}`);
const ok = makeSymbolicLink(devDir, `${targetDir}/${name}`);
process.exit(ok ? 0 : 1);
