# SEO Strategy — Church Machine / S-IDE v1

## Site overview
Church Machine is an educational / research platform for capability-based secure computing (the CLOOMC ISA on FPGA). The public-facing app is a Flask (Python/Gunicorn) server that serves SSR pages directly—there is no pure-SPA fallback for the main public routes. The primary product is a browser-based IDE (`/simulator/`), with a marketing landing page at `/`, and supporting docs/release pages.

## Public pages (in scope for SEO)
- `/` — Landing page (`landing.html`)
- `/simulator/` — Church Machine IDE (SSR-served HTML with SPA JS shell)
- `/start-guide` — Three-step onboarding wizard (inline HTML)
- `/release/r1/` — CM Release 1 document set
- `/release/r12/` — Wukong Artix-7 firmware download
- `/ide-intro/` — SPA introduction slides (Vite build)
- `/docs/` — Raw documentation files (markdown served as plain text)
- `/docs/business/deck.html`, `/docs/patents/index.html`, `/docs/six-laws/index.html` — HTML figures and business docs

## Out of scope
- `/api/**` — Internal API endpoints
- `/report/**`, `/internal/**` — Internal operational endpoints
- `/dl/**` — Binary download endpoints (PDF, bitstreams, zip)
- Authenticated dashboard views

## Target audience
- Hardware engineers, embedded systems developers, and computer science researchers interested in capability-based security and FPGA development.
- Academic/educational users learning about the Church-Turing Meta-Machine model.

## Primary keywords
- "capability-based secure computing"
- "Church Machine FPGA"
- "CLOOMC assembler IDE"
- "Golden Token security"
- "Wukong A7 FPGA IDE"

## Rendering mode
SSR (Flask). All public pages are served as complete HTML by the Python backend. The simulator page is served as a full HTML document (with JS-heavy UI on top). Metadata is baked into the HTML source.

## Dismissed categories
- (None yet)

## Notes
- The deployed domain appears to be `haskell-main-1.replit.app` based on robots.txt/sitemap.xml hardcoded URLs, but may be served under a custom domain as well.
- The `/simulator/` route 302-redirects to a versioned URL (`/simulator/~/[hash]`) on every request; the canonical in the HTML points back to `/simulator/`.
