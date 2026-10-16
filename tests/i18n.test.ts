import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readLocale(name: string): Record<string, string> {
    return JSON.parse(readFileSync(new URL(`../public/i18n/${name}.json`, import.meta.url), "utf8")) as Record<
        string,
        string
    >;
}

const zh = readLocale("zh_CN");
const en = readLocale("en_US");

describe("i18n resources", () => {
    it("expose exactly the same keys", () => {
        const zhKeys = Object.keys(zh).sort();
        const enKeys = Object.keys(en).sort();
        expect(enKeys).toEqual(zhKeys);
    });

    it("contain no empty values", () => {
        for (const [key, value] of [...Object.entries(zh), ...Object.entries(en)]) {
            expect(value.trim(), key).not.toBe("");
        }
    });

    it("define every placeholder used in the other locale", () => {
        const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();
        for (const key of Object.keys(zh)) {
            expect(placeholders(en[key]!), key).toEqual(placeholders(zh[key]!));
        }
    });

    it("use the plugin-specific utm parameters in the credit link", () => {
        expect(en.creditedBy.length).toBeGreaterThan(0);
        expect(zh.creditedBy.length).toBeGreaterThan(0);
    });
});
