# Before shipping

Things that must be done before a public release (a `[release]` commit or `v*` tag triggers the release
workflow; see `instructions/desktop.md`). Tick them off here and remove an item once it is resolved for good.

## Licences

- [ ] **Space Nova font** (numbers): buy a commercial licence that covers embedding in a game / app (desktop builds)
      and web embedding (the web build and the claude.ai artifact page inline the font file).
      https://maknastudio.com/product/space-nova/ — or replace it with a free font (e.g. Chakra Petch, already used).
- [ ] Replace the demo `src/fonts/space-nova.otf` with the licensed full version (demos can lack glyphs; today `⚠`
      and arrows fall back), keep the file name or update `src/style.css`.
- [ ] Update `credits.md` with the licence bought (type, date, licensee) and drop the "under evaluation" notes;
      keep the licence documents somewhere safe (not necessarily in the repo).
- [ ] While Space Nova is demo-licensed, don't push a `[release]` commit or `v*` tag, and don't share the preview
      artifact or builds publicly. If the GitHub repository is public, the font file in it is publicly
      downloadable: make it private or keep the font out of it until licensed.
- [ ] Check `credits.md` lists every third-party asset and library actually shipped, and that OFL fonts ship with
      their licence text (`public/licenses/`, copied into `dist/` and the desktop builds).
