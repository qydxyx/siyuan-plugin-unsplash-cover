/*
 * Keeps plugin.json and package.json versions in sync.
 *
 * Usage: pnpm run update-version -- 0.2.0
 */
import fs from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("Usage: pnpm run update-version -- <x.y.z>");
    process.exit(1);
}

for (const file of ["plugin.json", "package.json"]) {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.version = version;
    fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`Updated ${file} -> ${version}`);
}
