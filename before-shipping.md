# Before shipping

Things that must be done before a public release (a `[release]` commit or `v*` tag triggers the release
workflow; see `instructions/desktop.md`). Tick them off here and remove an item once it is resolved for good.

## Licences

- [ ] **Direction font**: buy a commercial licence that covers embedding in a game / app (desktop builds) and
      web embedding (the web build and the claude.ai artifact page inline the font file).
      https://brandsemut.com/product/direction/ — or replace the font.
- [ ] **Space Nova font**: same, https://maknastudio.com/product/space-nova/ — or replace the font.
- [ ] Replace the demo files in `src/fonts/` with the licensed full versions (demos can lack glyphs; today `·`, `—`,
      `⚠` and arrows fall back to the system font), keep the file names or update `src/style.css`.
- [ ] Update `credits.md` with the licence bought (type, date, licensee) and drop the "under evaluation" notes;
      keep the licence documents somewhere safe (not necessarily in the repo).
- [ ] While the fonts are demo-licensed, don't push a `[release]` commit or `v*` tag, and don't share the preview
      artifact or builds publicly. If the GitHub repository is public, the font files in it are publicly
      downloadable: make it private or keep the fonts out of it until licensed.
- [ ] Check `credits.md` lists every third-party asset and library actually shipped.
