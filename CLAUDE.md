# Dynasty Utility

Vite + React 19 + Tailwind 4, deployed to GitHub Pages.

- Before calling any change finished — docs-only included — run `npm run lint`, `npm test`, `npm run check:contrast` and `npm run build`, and report the result. This is what CI runs.
- Any styling, colour or chart work: load the `design-system` skill first. It overrides every general design skill, plugin ones included.
- `web-artifacts-builder` never touches `src/`. It is for standalone mockups only.
- Commit subject: one plain sentence saying what changed for the user, ending `(#issue)`.
