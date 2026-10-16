import { UnsplashError } from "@/types";

export type I18n = Record<string, string>;

/** Builds a translate function from the plugin's i18n map, falling back to the key itself. */
export function createTranslate(i18n: I18n): (key: string, params?: Record<string, string | number>) => string {
    return (key, params) => interpolate(i18n[key] ?? key, params);
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
    if (!params) {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    );
}

/** Normalizes `plugin.i18n` (Record<string, JSONValue>) into a string map. */
export function normalizeI18n(raw: unknown): I18n {
    const result: I18n = {};
    if (raw && typeof raw === "object") {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof value === "string") {
                result[key] = value;
            } else if (value !== null && value !== undefined && typeof value !== "object") {
                result[key] = String(value);
            }
        }
    }
    return result;
}

const ERROR_I18N_KEYS: Record<UnsplashError["kind"], string> = {
    noAccessKey: "errorNoAccessKey",
    invalidKey: "errorInvalidKey",
    rateLimit: "errorRateLimit",
    forbidden: "errorForbidden",
    network: "errorNetwork",
    tooLarge: "errorTooLarge",
    uploadFailed: "errorUploadFailed",
    unknown: "errorUnknown",
};

/** Maps any thrown value to a localized, user-facing message. */
export function describeError(t: ReturnType<typeof createTranslate>, error: unknown): string {
    if (error instanceof UnsplashError) {
        return t(ERROR_I18N_KEYS[error.kind], { msg: error.message });
    }
    if (error instanceof Error) {
        return t("errorUnknown", { msg: error.message });
    }
    return t("errorUnknown", { msg: String(error) });
}
