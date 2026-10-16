import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/types";
import type { PluginConfig, UnsplashPhoto } from "@/types";
import {
    buildAttributionAttrs,
    buildImageUrl,
    buildTitleImgCss,
    buildTitleImgValue,
    extractUrlFromTitleImgValue,
    safeTitleImgUrl,
    withUtm,
} from "@/services/title-img";

const config: PluginConfig = { ...DEFAULT_CONFIG, accessKey: "key", imageWidth: 1920, imageQuality: 80 };

const photo: UnsplashPhoto = {
    id: "abc123",
    description: null,
    alt_description: null,
    color: "#fff",
    width: 4000,
    height: 2000,
    urls: {
        raw: "https://images.unsplash.com/photo-1461988320302-91bde64fc8e4?ixid=2yJhcHBfaWQiOjEyMDd9",
        full: "https://images.unsplash.com/photo-1461988320302-91bde64fc8e4?ixid=ix&fm=jpg&q=80",
        regular: "https://images.unsplash.com/photo-1461988320302-91bde64fc8e4?ixid=ix&w=1080",
        small: "https://images.unsplash.com/photo-1461988320302-91bde64fc8e4?ixid=ix&w=400",
        thumb: "https://images.unsplash.com/photo-1461988320302-91bde64fc8e4?ixid=ix&w=200",
    },
    links: {
        html: "https://unsplash.com/photos/abc123",
        download_location: "https://api.unsplash.com/photos/abc123/download",
    },
    user: {
        name: "Jane Doe",
        username: "jane",
        links: { html: "https://unsplash.com/@jane" },
    },
};

describe("buildImageUrl", () => {
    it("merges resize parameters and keeps ixid", () => {
        const url = new URL(buildImageUrl(photo, config));
        expect(url.hostname).toBe("images.unsplash.com");
        expect(url.searchParams.get("ixid")).toBe("2yJhcHBfaWQiOjEyMDd9");
        expect(url.searchParams.get("w")).toBe("1920");
        expect(url.searchParams.get("q")).toBe("80");
        expect(url.searchParams.get("fm")).toBe("jpg");
        expect(url.searchParams.get("fit")).toBe("max");
    });

    it("does not produce characters that break the IAL attribute", () => {
        const value = buildImageUrl(photo, config);
        expect(value).not.toMatch(/["'`<>\\()\s]/);
    });
});

describe("safeTitleImgUrl", () => {
    it.each([
        "https://images.unsplash.com/photo-1?ixid=x&w=1920",
        "https://plus.unsplash.com/premium_photo-1?ixid=x",
        "assets/unsplash-abc123-20210719092549-9j5y79r.jpg",
    ])("accepts %s", (candidate) => {
        expect(safeTitleImgUrl(candidate)).not.toBeNull();
    });

    it.each([
        'javascript:alert(1)',
        "data:image/svg+xml;base64,PHN2Zz4=",
        "http://images.unsplash.com/photo-1",
        "https://images.unsplash.com.evil.example/photo-1",
        "https://evil.example/photo-1",
        "https://user:pass@images.unsplash.com/photo-1",
        "assets/../etc/passwd",
        "assets/sub/dir/photo.jpg",
        "assets/photo.exe",
        "/assets/photo.jpg",
        'https://images.unsplash.com/photo-1");background-image:url("javascript:alert(1)',
        "https://images.unsplash.com/photo-1?x=<script>",
        "",
        "   ",
    ])("rejects %s", (candidate) => {
        expect(safeTitleImgUrl(candidate)).toBeNull();
    });

    it("rejects overly long urls", () => {
        expect(safeTitleImgUrl(`https://images.unsplash.com/${"a".repeat(3000)}`)).toBeNull();
    });
});

describe("buildTitleImgValue", () => {
    it("produces the exact expected css shape", () => {
        expect(buildTitleImgValue("assets/photo-1.jpg")).toBe(
            'background-image:url("assets/photo-1.jpg");background-position:center 50%;',
        );
    });

    it("throws instead of writing an unsafe value", () => {
        expect(() => buildTitleImgValue("javascript:alert(1)")).toThrow();
    });

    it("is readable back out of the stored value", () => {
        const css = buildTitleImgCss("assets/photo-1.jpg");
        expect(extractUrlFromTitleImgValue(css)).toBe("assets/photo-1.jpg");
    });
});

describe("attribution", () => {
    it("adds the utm parameters", () => {
        const url = new URL(withUtm("https://unsplash.com/@jane"));
        expect(url.searchParams.get("utm_source")).toBe("siyuan_unsplash_plugin");
        expect(url.searchParams.get("utm_medium")).toBe("referral");
    });

    it("writes the photo id, author and links", () => {
        const attrs = buildAttributionAttrs(photo);
        expect(attrs["custom-unsplash-id"]).toBe("abc123");
        expect(attrs["custom-unsplash-author"]).toBe("Jane Doe");
        expect(attrs["custom-unsplash-author-url"]).toContain("utm_source=siyuan_unsplash_plugin");
        expect(attrs["custom-unsplash-link"]).toContain("utm_medium=referral");
    });
});
