# Unsplash Cover for SiYuan

[中文说明](README_zh_CN.md)

Pick photos from [Unsplash](https://unsplash.com) as the cover image (`title-img`) of a SiYuan document.
The picker opens with the current document title already tokenized into search keywords, so the first
screen of candidates is usually relevant without typing anything.

## Features

- **Title-driven pre-search** — the document title is cleaned (dates, brackets, "读书笔记/meeting notes"-style
  boilerplate, chapter prefixes) and tokenized with the browser-native `Intl.Segmenter`. No dictionary is
  bundled and no background work happens: tokenizing only runs when you open the picker.
- **Search with keyword chips** — click any extracted token to search it alone, or the combined query.
- **One-click random cover** — from the title icon menu, the top bar or a command, without opening a dialog.
- **Two storage modes** — reference the Unsplash CDN (default) or download the photo into the workspace
  `data/assets/` folder through the kernel API.
- **Attribution kept with the document** — the photographer, the photo id and the links are written to
  `custom-unsplash-*` block attributes, so a cover stays traceable.
- **Restore the previous cover** — the picker keeps the last cover per document for one-click rollback.
- **Works on restricted networks** — all requests (API and images) can be routed through the SiYuan
  kernel proxy.

## Getting an Access Key

1. Create an application at <https://unsplash.com/oauth/applications>.
2. Copy its **Access Key** (not the secret key).
3. Open **Settings → Unsplash Cover** in SiYuan and paste it.

A developer (demo) key allows **50 requests per hour**, which is counted per `api.unsplash.com` call only;
image downloads from `images.unsplash.com` are not counted. The plugin caches search results for 10 minutes,
de-duplicates identical in-flight requests and shows the remaining quota in the picker footer, so a demo key
is usually enough.

Alternatively you can store the key in SiYuan's encrypted secret store (**Settings → Secret and variables**)
under the name `unsplash_access_key`; the plugin prefers it when present.

## Compliance notes

- By default the plugin **hotlinks the URLs returned by the Unsplash API**, as required by the
  [Unsplash API guidelines](https://help.unsplash.com/en/collections/1451694-api-guidelines). Saving photos
  locally is an explicit opt-in, because the guidelines expect the API-provided URLs to be used for every
  use of the image.
- Photos are resized by merging imgix parameters (`w`, `q`, `fm`, `fit`) into the returned URL, keeping the
  `ixid` parameter intact so photo views can still be attributed.
- Applying a photo calls `photo.links.download_location` once, and the picker shows the photographer with a
  UTM-tagged link.
- Cover images in SiYuan are stored as the `title-img` block attribute, where a photographer credit line
  cannot be rendered. The plugin therefore writes the attribution into `custom-unsplash-*` attributes of the
  document; the picker shows the photographer while choosing.

## Privacy

- The plugin never uploads note content. Only the keywords derived from the document title (or the keywords
  you type) are sent to `api.unsplash.com`, and only when you open the picker, click random, or run a command.
- The Access Key is stored in plain text in this workspace's plugin data (which is synced to the cloud) unless
  you use SiYuan's secret store instead. Prefer a low-privilege demo key.

## Local assets

When **Save into local assets** is enabled, the photo is downloaded and written through
`POST /api/asset/upload` (never by writing files directly), so it syncs like any other asset. Repeatedly
changing covers leaves unreferenced files behind: use SiYuan's built-in unused-asset cleanup from time to
time. Choosing the same photo again reuses the previously downloaded file instead of downloading it twice.

## Commands

| Command | Description |
| --- | --- |
| `Unsplash: open the photo picker` | Opens the picker for the current document |
| `Unsplash: randomize the cover image` | Applies a random photo without opening a dialog |

Both can be bound to a hotkey in **Settings → Keymap**. They are also reachable from the document title icon
menu and the top bar button.

## Development

```bash
pnpm install
pnpm run dev            # watch build into dev/
pnpm run make-link      # symlink dev/ into {workspace}/data/plugins (SiYuan must be running)
pnpm run check          # tsc + svelte-check
pnpm run test           # vitest
pnpm run build          # dist/ + package.zip
```

`make-link` accepts a target directory as well:
`pnpm run make-link -- /path/to/workspace/data/plugins`, or set `SIYUAN_PLUGIN_DIR`.

## License

MIT
