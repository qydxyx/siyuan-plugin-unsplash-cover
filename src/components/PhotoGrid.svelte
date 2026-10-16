<script lang="ts">
    import type { Translate, UnsplashPhoto } from "@/types";
    import { withUtm } from "@/services/title-img";

    interface Props {
        photos: UnsplashPhoto[];
        busyId: string | null;
        busyStage: "downloading" | "applying" | null;
        doneIds: string[];
        t: Translate;
        onpick: (photo: UnsplashPhoto) => void;
    }

    let { photos, busyId, busyStage, doneIds, t, onpick }: Props = $props();

    function label(photo: UnsplashPhoto): string {
        return photo.alt_description ?? photo.description ?? "Unsplash photo";
    }

    function openAuthor(event: MouseEvent, photo: UnsplashPhoto) {
        event.stopPropagation();
        event.preventDefault();
        const url = photo.user?.links?.html;
        if (url) {
            window.open(withUtm(url), "_blank", "noopener,noreferrer");
        }
    }
</script>

<div class="unsplash-grid">
    {#each photos as photo (photo.id)}
        <div
            class="unsplash-card"
            class:unsplash-card--busy={busyId === photo.id}
            role="button"
            tabindex="0"
            aria-busy={busyId === photo.id}
            onclick={() => onpick(photo)}
            onkeydown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onpick(photo);
                }
            }}
        >
            <img src={photo.urls.small} alt={label(photo)} loading="lazy" draggable="false" />
            <div class="unsplash-card__credit">
                <span>{photo.user?.name ?? ""}</span>
                <button
                    class="unsplash-card__author"
                    type="button"
                    title={t("creditedBy")}
                    onclick={(event) => openAuthor(event, photo)}
                >Unsplash</button>
            </div>
            {#if busyId === photo.id}
                <div class="unsplash-card__overlay">
                    <div class="unsplash-spinner"></div>
                    <span>{busyStage === "downloading" ? t("downloading") : t("applying")}</span>
                </div>
            {:else if doneIds.includes(photo.id)}
                <div class="unsplash-card__overlay unsplash-card__overlay--done">
                    <svg><use xlink:href="#iconCheck"></use></svg>
                    <span>{t("applied")}</span>
                </div>
            {/if}
        </div>
    {/each}
</div>
