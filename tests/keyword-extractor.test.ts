import { describe, expect, it, afterEach } from "vitest";
import { cleanTitle, extractKeywordsFromTitle, resetSegmenterCache } from "@/services/keyword-extractor";

const FALLBACK = "nature landscape";

function restoreSegmenter(original: typeof Intl.Segmenter | undefined) {
    if (original) {
        (Intl as unknown as Record<string, unknown>).Segmenter = original;
    }
    resetSegmenterCache();
}

describe("cleanTitle", () => {
    it("removes dates, brackets, boilerplate and section prefixes in a fixed order", () => {
        const cleaned = cleanTitle("2026-10-16 【读书笔记】第3章：秋日露营与咖啡冲泡指南");
        expect(cleaned).not.toMatch(/2026|10-16|16/);
        expect(cleaned).not.toContain("读书笔记");
        expect(cleaned).not.toContain("第3章");
        expect(cleaned).toContain("露营");
        expect(cleaned).toContain("咖啡");
    });

    it("handles the CJK date suffix without leaving stray characters", () => {
        const cleaned = cleanTitle("2026年10月16日 秋日露营");
        expect(cleaned).not.toContain("日 秋");
        expect(cleaned).toBe("秋日露营");
    });

    it("keeps bare words that are not dates", () => {
        expect(cleanTitle("16日露营")).toBe("16日露营");
    });
});

describe("extractKeywordsFromTitle", () => {
    it("extracts usable keywords from a noisy title", () => {
        const result = extractKeywordsFromTitle("2026-10-16 【读书笔记】第3章：秋日露营与咖啡冲泡指南", FALLBACK);
        expect(result.tokens).toContain("露营");
        expect(result.tokens).toContain("咖啡");
        expect(result.tokens.join(" ")).not.toMatch(/2026|读书笔记|第3章|指南/);
        expect(result.primaryQuery).not.toBe(FALLBACK);
        expect(result.primaryQuery.length).toBeGreaterThan(0);
    });

    it.each(["2026-10-16 周报", "未命名", "", "   ", "Untitled"])("falls back for %j", (title) => {
        const result = extractKeywordsFromTitle(title, FALLBACK);
        expect(result.primaryQuery).toBe(FALLBACK);
        expect(result.tokens).toEqual([]);
    });

    it("keeps a two-character word intact", () => {
        const result = extractKeywordsFromTitle("秋日", FALLBACK);
        expect(result.tokens).toContain("秋日");
        expect(result.primaryQuery).toBe("秋日");
    });

    it("drops single characters and stopwords", () => {
        const result = extractKeywordsFromTitle("关于使用咖啡的方法", FALLBACK);
        expect(result.tokens).not.toContain("的");
        expect(result.tokens).not.toContain("关于");
        expect(result.tokens).not.toContain("使用");
        expect(result.tokens.join(" ")).not.toMatch(/\b方法\b/);
    });

    it("limits the token list and the primary query", () => {
        const result = extractKeywordsFromTitle("秋日露营咖啡冲泡指南山野徒步摄影记录", FALLBACK);
        expect(result.tokens.length).toBeLessThanOrEqual(6);
        expect(result.primaryQuery.split(" ").length).toBeLessThanOrEqual(3);
    });

    it("stays fast on warm calls", () => {
        const title = "2026-10-16 【读书笔记】第3章：秋日露营与咖啡冲泡指南";
        extractKeywordsFromTitle(title, FALLBACK); // warm up: creating the segmenter loads ICU data
        const start = performance.now();
        const iterations = 500;
        for (let index = 0; index < iterations; index += 1) {
            extractKeywordsFromTitle(title, FALLBACK);
        }
        const average = (performance.now() - start) / iterations;
        expect(average).toBeLessThan(2);
    });
});

describe("extractKeywordsFromTitle without Intl.Segmenter", () => {
    const original = Intl.Segmenter;

    afterEach(() => {
        restoreSegmenter(original);
    });

    it("falls back to the built-in splitter instead of throwing", () => {
        delete (Intl as unknown as Record<string, unknown>).Segmenter;
        resetSegmenterCache();
        const result = extractKeywordsFromTitle("秋日露营与咖啡冲泡指南", FALLBACK);
        expect(result.primaryQuery).not.toBe(FALLBACK);
        expect(result.tokens.length).toBeGreaterThan(0);
    });
});
