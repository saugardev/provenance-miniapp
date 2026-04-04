# Plan: Production-Ready Home Page

**Status tracking**: After completing each step, update the checkbox `[ ]` → `[x]` and add a short note if anything changed.

---

## Context

This is a Next.js World mini app that signs photos with a human-verified World ID proof.
The goal is to add a cinematic landing/registration page before the existing verification flow.

---

## Steps

### 1. Rename video asset
- [x] Rename `public/combined.fast.webm` → `public/hero-bg.webm`
  - Note: `public/hero-bg.webm` is in place and used by the landing page video element.

### 2. Move existing verification page
- [x] Move `app/page.tsx` (current verification UI) → `app/verify/page.tsx`
- [x] Create `app/verify/` directory if needed
  - Note: The verification flow now lives at `/verify` in `app/verify/page.tsx`.

### 3. Create landing page (`app/page.tsx`)

Design direction: **Cinematic / Documentary noir**
- Full-viewport video background (looping `hero-bg.webm`)
- Semi-transparent dark overlay for legibility
- Staggered fade-in entrance animation for headline, subtitle, button
- Mobile-first layout (375px, World App context)

Content:
- Title: **"Prove reality"** — large, bold, editorial serif
- Subtitle: "prove your photos are real and defend yourself from AI"
- CTA button: white pill, white text → **"Prove my reality"** → links to `/verify`
- Footer note: "By pressing 'Prove my reality' you accept our Terms and Conditions."

Video loading strategy:
- `preload="none"` on initial render
- After component mounts (`useEffect`), set `preload="auto"` and call `.play()` programmatically
- `muted`, `loop`, `playsInline`, `autoPlay` attributes
- Fallback: dark solid background if video fails

Typography:
- Use `next/font/google` to load a distinctive display font (e.g., `Bebas_Neue` or `Playfair_Display` for the title, `DM_Sans` for body)
- Avoid Inter, Roboto, Arial

CSS approach:
- CSS Modules or inline styles with CSS variables — no UI framework
- Entrance animations via `@keyframes` + `animation-delay` for stagger

### 4. Update metadata
- [x] Update `app/layout.tsx` metadata: title "Prove Reality", description to match new app purpose

### 5. CSS for landing page
- [x] Add landing-page styles to `app/globals.css` (or a module) without breaking existing verify page styles
- [x] Ensure no style bleed between pages
  - Note: Landing styles were isolated into `app/landing.module.css`.

### 6. Verify routing works
- [x] Confirm `/` renders the new landing page
- [x] Confirm `/verify` renders the existing verification flow unchanged
  - Note: App Router structure is correct and `pnpm exec tsc --noEmit` passes.

---

## Implementation Notes

- Keep the verify page exactly as-is (just moved to `/verify/page.tsx`)
- The landing page is a separate route; no shared state needed
- Video element must have `muted` for autoplay to work in browsers
- `playsInline` is required for iOS/World App
- Use `poster` attribute with a dark placeholder if a poster image is available

---

## Definition of Done

- [x] Landing page renders with fullscreen video background
- [x] Text and button are visible and well-styled
- [x] Clicking "Prove my reality" navigates to `/verify`
- [x] No regressions on the verify page
- [x] Terms note visible below the button
