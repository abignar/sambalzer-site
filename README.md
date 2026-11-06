# Sam Balzer — website

A single-page portfolio site. No build step: it's just `index.html` plus an `images/` folder, hosted on Cloudflare Pages.

## Adding a new artwork

1. **Prepare the image**
   - Export as JPG in sRGB.
   - Full size: about **2000px** on the longest side, under ~500 KB.
   - Thumbnail: about **900px** on the longest side.
   - Name it lowercase with hyphens, no spaces, e.g. `2026-low-tide.jpg`.

2. **Add the files**
   - Full image → `images/2026-low-tide.jpg`
   - Thumbnail → `images/thumbs/2026-low-tide.jpg` (same file name)

3. **Add one line to the list in `index.html`.** Search for `const WORKS` and add:

   ```js
   { title:"Low Tide", year:"2026", medium:"Oil on linen", size:"60 × 40 cm", cat:"Landscape", src:"images/2026-low-tide.jpg" },
   ```

   - Leave `year`, `medium` or `size` as `""` to hide them.
   - `cat` must be one of the `CATEGORIES` (currently Figurative, Landscape, Drawing). Add a new name to `CATEGORIES` to create a new filter.
   - The grid fills **down each column**, so the first few lines in the list appear along the left-hand column first.

4. **Commit and push.** Cloudflare Pages redeploys automatically within a minute.

### Editing on github.com (no software needed)

- Open the repo → `images` → **Add file → Upload files** to add images (do the same inside `images/thumbs`).
- Open `index.html` → pencil icon → edit the `WORKS` list → **Commit changes**.

## Other things you can change in `index.html`

- `HERO` — the big cover image, its title and the line under it.
- `PORTRAIT` — the image in the About section.
- About text, exhibition list, email and Instagram — plain HTML, search for `id="about"` and `id="contact"`.
- Background colour — `--bg` near the top (currently Pantone 11-0602 TCX, `#f2f0eb`).
- Font — Supreme from Fontshare, loaded in the `<head>`.

## Connecting to Cloudflare Pages (one-time)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick this repository.
3. Framework preset: **None**. Build command: *(leave empty)*. Build output directory: `/`.
4. Deploy, then go to **Custom domains → Set up a custom domain** and pick your domain. Because the domain is already on Cloudflare, the DNS record is added for you.
