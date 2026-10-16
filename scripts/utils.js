/*
 * Adapted from siyuan-note/plugin-sample-vite-svelte (MIT, (c) frostime).
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import readline from "node:readline";

export const log = (info) => console.log("\x1B[36m%s\x1B[0m", info);
export const error = (info) => console.log("\x1B[31m%s\x1B[0m", info);

const POST_HEADER = { "Content-Type": "application/json" };

function myfetch(url, options) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, options, (res) => {
            let data = "";
            res.on("data", (chunk) => {
                data += chunk;
            });
            res.on("end", () => {
                resolve({ ok: true, status: res.statusCode, json: () => JSON.parse(data) });
            });
        });
        req.on("error", reject);
        req.end();
    });
}

export async function getSiYuanDir() {
    try {
        const response = await myfetch("http://127.0.0.1:6806/api/system/getWorkspaces", {
            method: "POST",
            headers: POST_HEADER,
        });
        if (!response.ok) {
            error(`\tHTTP-Error: ${response.status}`);
            return null;
        }
        const conf = await response.json();
        return conf?.data;
    } catch (e) {
        error(`\tError: ${e}`);
        error("\tPlease make sure SiYuan is running!!!");
        return null;
    }
}

export async function chooseTarget(workspaces) {
    const count = workspaces.length;
    log(`>>> Got ${count} SiYuan ${count > 1 ? "workspaces" : "workspace"}`);
    workspaces.forEach((workspace, i) => log(`\t[${i}] ${workspace.path}`));

    if (count === 1) {
        return `${workspaces[0].path}/data/plugins`;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const index = await new Promise((resolve) => {
        rl.question(`\tPlease select a workspace[0-${count - 1}]: `, (answer) => resolve(answer));
    });
    rl.close();
    return `${workspaces[index.trim()].path}/data/plugins`;
}

export function getThisPluginName() {
    if (!fs.existsSync("./plugin.json")) {
        process.chdir("../");
        if (!fs.existsSync("./plugin.json")) {
            error("Failed! plugin.json not found");
            return null;
        }
    }
    const plugin = JSON.parse(fs.readFileSync("./plugin.json", "utf8"));
    const name = plugin?.name;
    if (!name) {
        error("Failed! Please set plugin name in plugin.json");
        return null;
    }
    return name;
}

export function copyDirectory(srcDir, dstDir) {
    if (!fs.existsSync(dstDir)) {
        fs.mkdirSync(dstDir, { recursive: true });
        log(`Created directory ${dstDir}`);
    }
    for (const file of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const src = path.join(srcDir, file.name);
        const dst = path.join(dstDir, file.name);
        if (file.isDirectory()) {
            copyDirectory(src, dst);
        } else {
            fs.copyFileSync(src, dst);
        }
    }
    log(`All files copied from ${srcDir} to ${dstDir}`);
}

export function makeSymbolicLink(srcPath, targetPath) {
    if (fs.existsSync(targetPath) || fs.lstatSync(targetPath, { throwIfNoEntry: false })) {
        const stat = fs.lstatSync(targetPath);
        if (!stat.isSymbolicLink()) {
            error(`Failed! ${targetPath} already exists and is not a symbolic link`);
            return false;
        }
        const existedPath = fs.readlinkSync(targetPath);
        if (path.resolve(existedPath) === path.resolve(srcPath)) {
            log(`Good! ${targetPath} is already linked to ${srcPath}`);
            log(`Link ${targetPath} -> ${srcPath}`);
            return true;
        }
        error(`Error! Already exists symbolic link ${targetPath}\nBut it links to ${existedPath}`);
        error("Removing the stale link and re-creating it...");
        fs.unlinkSync(targetPath);
    }
    fs.symlinkSync(srcPath, targetPath, "dir");
    log(`Done! Created symlink ${targetPath} -> ${srcPath}`);
    return true;
}

/** Resolve the SiYuan plugins dir from CLI arg, env var, or auto-detection. */
export async function resolveTargetDir(cliArg) {
    if (cliArg) {
        log(`>>> Using target directory from command line argument: ${cliArg}`);
        return cliArg;
    }
    const env = process.env?.SIYUAN_PLUGIN_DIR;
    if (env) {
        log(`>>> Using target directory from environment variable "SIYUAN_PLUGIN_DIR": ${env}`);
        return env;
    }
    log(">>> Trying to detect the SiYuan directory automatically (requires SiYuan to be running)...");
    const workspaces = await getSiYuanDir();
    if (!workspaces || workspaces.length === 0) {
        error(">>> Can not detect the SiYuan directory automatically.");
        error(">>> Pass it as an argument or set SIYUAN_PLUGIN_DIR, e.g.");
        error('>>>   pnpm run make-link /path/to/workspace/data/plugins');
        return null;
    }
    return await chooseTarget(workspaces);
}
