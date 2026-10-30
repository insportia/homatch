# Pinned production fonts for the browser tests

Production loads Inter, Manrope and Noto Sans Georgian / Hebrew / Arabic from
the Google Fonts stylesheet imported by `src/index.css`. The mobile suites stub
every request that leaves the preview server, so without these copies no web
font loads and every width is measured in the machine's system font: Segoe UI
on Windows, something else on the Linux runner, never what customers see.

- `google/css2.css`: the stylesheet exactly as Google serves it to Chrome
  (variable weights, one `@font-face` per `unicode-range` subset).
- `google/s/...`: every woff2 file it names, at its original fonts.gstatic.com path.
- `MANIFEST.json`: source URL, fetch date and the SHA-256 of every file.
- `licenses/`: the SIL Open Font License 1.1 of each family.

`tests/mobile/productionFonts.mjs` serves these to the page and reads back,
through the Chrome DevTools Protocol (`CSS.getPlatformFontsForNode`), which
faces Chrome actually drew. `document.fonts.check()` is not proof: it answers
`true` for a family that no `@font-face` declares.

Before serving anything, the helper checks the pin: if `src/index.css` imports a
different stylesheet, or a file no longer matches its hash, the suite fails
instead of silently measuring something else.

Refresh after changing the font import in `src/index.css`:

    node scripts/fonts/pin-test-fonts.mjs
    node scripts/fonts/pin-test-fonts.mjs --check

Test fixtures only. Production typography is unchanged and still comes from Google Fonts.
