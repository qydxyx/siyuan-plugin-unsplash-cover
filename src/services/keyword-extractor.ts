import type { TitleExtractionResult } from "@/types";

/** Minimal built-in stopword list: no dictionary is bundled, Intl.Segmenter does the tokenizing. */
const STOPWORDS = new Set([
    // Chinese function words
    "的", "了", "和", "与", "及", "在", "是", "我", "你", "他", "她", "它", "们", "这", "那", "有", "无", "不",
    "把", "被", "给", "对", "从", "到", "为", "以", "而", "但", "或", "也", "都", "就", "还", "又", "很", "更",
    "最", "只", "会", "能", "要", "想", "让", "说", "做", "个", "些", "之", "其", "中", "上", "下", "里", "外",
    // Chinese meta words commonly found in note titles
    "如何", "什么", "怎么", "为什么", "关于", "使用", "指南", "教程", "分析", "研究", "笔记", "记录", "文档",
    "方法", "问题", "总结", "介绍", "说明", "示例", "分享", "整理", "入门", "实践", "方案", "思考", "心得",
    // English function words
    "the", "a", "an", "of", "in", "on", "at", "for", "to", "with", "and", "or", "but", "if", "is", "are", "was",
    "were", "be", "been", "being", "it", "its", "this", "that", "these", "those", "as", "by", "from", "into",
    "about", "how", "what", "why", "when", "where", "which", "who", "whom", "whose", "can", "could", "should",
    "would", "will", "shall", "may", "might", "must", "do", "does", "did", "done", "not", "no", "yes", "notes",
    "note", "draft", "guide", "tutorial", "summary", "untitled",
]);

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
const CJK_RUN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/g;

const DATE_PATTERNS: RegExp[] = [
    // 2026-10-16 / 2026/10/16 / 2026.10.16 / 2026年10月16日
    /(?<!\d)\d{4}\s*[-/.年]\s*\d{1,2}(?:\s*[-/.月]\s*\d{1,2}\s*日?)?(?!\d)/g,
    // 20261016
    /(?<!\d)\d{8}(?!\d)/g,
    // 10-16 16:30 style time stamps
    /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g,
];

const BRACKET_PATTERNS: RegExp[] = [/【[^】]*】/g, /\[[^\]]*\]/g, /（[^）]*）/g, /\([^)]*\)/g, /｛[^｝]*｝/g];

const BOILERPLATE_PATTERN =
    /读书笔记|学习笔记|课堂笔记|学习记录|会议纪要|会议记录|周报|月报|日报|季报|年报|复盘|总结|草稿|待办|随手记|未命名|untitled|todo|draft/gi;

const SECTION_PREFIX_PATTERN =
    /^\s*(?:第\s*[一二三四五六七八九十百千万零两0-9]+\s*[章节篇讲课回部]|chapter\s*\d+|part\s*\d+|\d+(?:\.\d+)+\s*|\d+[\s.、\-:：]+)\s*/i;

const PUNCTUATION_PATTERN = /[\p{P}\p{S}]+/gu;

const MAX_TOKENS = 6;
const MAX_PRIMARY_TOKENS = 3;

let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
    if (segmenter !== undefined) {
        return segmenter;
    }
    try {
        segmenter =
            typeof Intl !== "undefined" && "Segmenter" in Intl
                ? new Intl.Segmenter("zh-CN", { granularity: "word" })
                : null;
    } catch {
        segmenter = null;
    }
    return segmenter;
}

/** Test helper: forces the lazy segmenter to be re-created. */
export function resetSegmenterCache(): void {
    segmenter = undefined;
}

export function cleanTitle(rawTitle: string): string {
    let text = (rawTitle ?? "").normalize("NFKC");
    for (const pattern of DATE_PATTERNS) {
        text = text.replace(pattern, " ");
    }
    for (const pattern of BRACKET_PATTERNS) {
        text = text.replace(pattern, " ");
    }
    text = text.replace(BOILERPLATE_PATTERN, " ");
    text = text.replace(PUNCTUATION_PATTERN, " ");
    text = text.replace(SECTION_PREFIX_PATTERN, " ");
    return text.replace(/\s+/g, " ").trim();
}

function isUsableToken(token: string): boolean {
    if (!token || STOPWORDS.has(token.toLowerCase())) {
        return false;
    }
    if (/^\d+$/.test(token)) {
        return false;
    }
    const hasCJK = CJK_PATTERN.test(token);
    if (hasCJK) {
        // Keep meaningful words: "秋日", "露营", but drop single characters.
        return token.replace(/[^\p{L}]/gu, "").length >= 2;
    }
    return token.length >= 2 && /[a-zA-Z]/.test(token);
}

/** Fallback used when Intl.Segmenter is unavailable on an old webview. */
function fallbackSegment(text: string): string[] {
    const tokens: string[] = [];
    for (const chunk of text.split(/\s+/)) {
        if (!chunk) {
            continue;
        }
        if (!CJK_PATTERN.test(chunk)) {
            tokens.push(chunk);
            continue;
        }
        const runs = chunk.match(CJK_RUN_PATTERN) ?? [];
        for (const run of runs) {
            if (run.length <= MAX_TOKENS) {
                tokens.push(run);
                continue;
            }
            for (let index = 0; index + 1 < run.length; index += 2) {
                tokens.push(run.slice(index, index + 2));
            }
        }
    }
    return tokens;
}

export function segmentTitle(cleaned: string): string[] {
    if (!cleaned) {
        return [];
    }
    const activeSegmenter = getSegmenter();
    if (!activeSegmenter) {
        return fallbackSegment(cleaned);
    }
    const tokens: string[] = [];
    for (const part of activeSegmenter.segment(cleaned)) {
        if (part.isWordLike) {
            tokens.push(part.segment);
        }
    }
    return tokens;
}

/**
 * Extracts search keywords from a document title.
 *
 * Zero third-party dependencies and no resident cost: the Intl.Segmenter instance
 * is created lazily on first use and reused afterwards.
 */
export function extractKeywordsFromTitle(rawTitle: string, fallbackQuery = "nature landscape"): TitleExtractionResult {
    const cleaned = cleanTitle(rawTitle);
    const seen = new Set<string>();
    const tokens: string[] = [];

    for (const candidate of segmentTitle(cleaned)) {
        const token = candidate.trim();
        const key = token.toLowerCase();
        if (!isUsableToken(token) || seen.has(key)) {
            continue;
        }
        seen.add(key);
        tokens.push(token);
        if (tokens.length >= MAX_TOKENS) {
            break;
        }
    }

    const primaryQuery = tokens.slice(0, MAX_PRIMARY_TOKENS).join(" ");
    return {
        primaryQuery: primaryQuery || fallbackQuery,
        tokens,
    };
}
