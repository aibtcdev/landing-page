# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AIBTC landing page for the AI x Bitcoin working group. Built with Next.js 15, React 19, Tailwind CSS 4, and deployed to Cloudflare Workers via OpenNext.

## Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
npm run preview      # Build and preview on Cloudflare Workers locally
npm run deploy       # Deploy to Cloudflare Workers (requires .env with CF credentials)
```

## Architecture

- **Next.js 15 App Router** with React 19 and TypeScript
- **Tailwind CSS 4** with custom theme in `globals.css` (uses `@theme` directive)
- **Cloudflare Workers** deployment via `@opennextjs/cloudflare`

## Key Files

- `app/page.tsx` - Main landing page (client component with scroll effects and animated background)
- `app/guide/page.tsx` - Interactive step-by-step guide for building with Bitcoin agents
- `app/layout.tsx` - Root layout with metadata and Open Graph configuration
- `app/globals.css` - Global styles, custom fonts (Roc Grotesk), and CSS animations
- `next.config.ts` - Next.js configuration
- `wrangler.jsonc` - Cloudflare Workers configuration (routes to aibtc.com)

## Styling Patterns

- Uses CSS custom properties via `@theme` (e.g., `--color-orange: #F7931A`)
- Custom animation classes: `animate-float1`, `animate-fadeUp`, `animate-bounce-slow`
- Card effects: `card-glow` (mouse-follow gradient) and `card-accent` (top border on hover)
- Respects `prefers-reduced-motion` for accessibility

## Brand Colors

- Orange (primary): `#F7931A`
- Blue: `#7DA2FF`
- Purple: `#A855F7`
