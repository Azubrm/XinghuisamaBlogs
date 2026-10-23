# Self-hosted fonts

These files keep the site's existing Noto Serif SC, Geist, and Geist Mono
fonts available without contacting Google Fonts during builds or page loads.

The WOFF2 files and @font-face declarations were copied from a successful
Next.js 16.2.1 production build of this project on 2026-10-23. The original
build used next/font/google with Noto Serif SC weights 400, 700, and 900,
and variable Geist / Geist Mono weights 100 through 900. Unicode subsets,
font-display behavior, and fallback metric declarations are preserved.
Only font-file URLs have been changed to relative paths, so the bundler
can serve assets from the site's own origin and respect its base path.

Original font projects:

- Noto Serif SC: https://github.com/notofonts/noto-cjk
- Geist and Geist Mono: https://github.com/vercel/geist-font

The fonts are distributed under the SIL Open Font License 1.1. License
texts were obtained from the Google Fonts repository:

- https://github.com/google/fonts/blob/main/ofl/notoserifsc/OFL.txt
- https://github.com/google/fonts/blob/main/ofl/geist/OFL.txt
- https://github.com/google/fonts/blob/main/ofl/geistmono/OFL.txt

Keep this directory identical in XHBlogs and my-blog-manager. Do not replace
these faces with next/font/google unless builds are intended to require
external access to Google Fonts again.
