# Social asset pack

Generated from `logo-mark.svg`, `logo-wordmark.svg`, and `og.svg` via sharp-cli.
Re-render any of these with the commands at the bottom of this file.

## Avatars (square, dark `#0E1012` background)

| File | Size | Use |
|---|---|---|
| `avatar-256.png` | 256×256 | Reddit, small fallback |
| `avatar-400.png` | 400×400 | X / Twitter, Mastodon, Bluesky, IG |
| `avatar-512.png` | 512×512 | Discord server icon, generic |
| `avatar-800.png` | 800×800 | YouTube channel icon (min 800), high-res |
| `avatar-1024.png` | 1024×1024 | High-res master, future-proof |

## Avatars (transparent — for light backgrounds, slides, embeds)

| File | Size |
|---|---|
| `avatar-512-transparent.png` | 512×512 |
| `avatar-1024-transparent.png` | 1024×1024 |

## Wordmark (full "pacelore" logotype, 5:1 aspect)

| File | Size | Use |
|---|---|---|
| `wordmark-dark.png` | 1280×256 | Dark-bg headers, README hero |
| `wordmark-transparent.png` | 1280×256 | Overlays, light bg, watermark |

## Banners

| File | Size | Platform |
|---|---|---|
| `x-header.png` | 1500×500 | X / Twitter profile header |
| `linkedin-banner.png` | 1584×396 | LinkedIn personal banner (use for the company page too) |
| `youtube-banner.png` | 2560×1344 | YouTube channel banner — safe area centered |
| `discord-invite.png` | 960×540 | Discord invite link unfurl card |

## Profile copy (paste into bio fields)

**X / Bluesky / Mastodon** (160 char limit):
> Source-available Strava + TrainingPeaks alternative. Free what they paywall — TSS, NP, IF, GAP, CTL/ATL/TSB. On Cloudflare. github.com/pablocaminog/pacelore

**Reddit** (200 char):
> The free, source-available Strava + TrainingPeaks alternative. All the analytics, none of the paywall. github.com/pablocaminog/pacelore

**LinkedIn page tagline** (120 char):
> Free, source-available training platform on Cloudflare's edge. The Strava + TrainingPeaks alternative.

**LinkedIn page description** (250 char):
> pacelore is a source-available training platform that puts every analytic Strava and TrainingPeaks paywall — TSS, NP, IF, peak power curves, GAP, the PMC chart — on a free, self-hostable stack running on Cloudflare's edge.

**YouTube channel description** (1000 char):
> pacelore is the free, source-available alternative to Strava and TrainingPeaks. We compute every analytic the incumbents charge for — TSS, NP, IF, peak power curves, GAP, decoupling, CTL/ATL/TSB — on infrastructure that costs $0.012 per athlete per month to run.
>
> This channel is build-in-public dev logs, plain-English explainers of the math behind training metrics, and walkthroughs of the open-source codebase.
>
> Source: github.com/pablocaminog/pacelore
> Site: pacelore.com
> License: PolyForm Noncommercial 1.0.0

**Discord server name + description**:
> pacelore — source-available training platform. Cyclists, runners, triathletes, devs welcome. Free forever.

## Re-rendering

If you change `logo-mark.svg`, `logo-wordmark.svg`, or `og.svg`, regenerate everything in this directory:

```bash
cd apps/web/public

# Avatars (dark bg)
for size in 256 400 512 800 1024; do
  pnpm dlx -s sharp-cli --input logo-mark.svg --output social/avatar-${size}.png \
    resize $size $size -- flatten "#0E1012"
done

# Avatars (transparent)
for size in 512 1024; do
  pnpm dlx -s sharp-cli --input logo-mark.svg --output social/avatar-${size}-transparent.png \
    resize $size $size
done

# Wordmark
pnpm dlx -s sharp-cli --input logo-wordmark.svg --output social/wordmark-dark.png \
  resize 1280 256 -- flatten "#0E1012"
pnpm dlx -s sharp-cli --input logo-wordmark.svg --output social/wordmark-transparent.png \
  resize 1280 256

# Banners
pnpm dlx -s sharp-cli --input og.svg --output /tmp/og-full.png resize 1500 788
pnpm dlx -s sharp-cli --input /tmp/og-full.png --output social/x-header.png \
  extract 144 0 1500 500
pnpm dlx -s sharp-cli --input og.svg --output /tmp/og-li.png resize 1584 832
pnpm dlx -s sharp-cli --input /tmp/og-li.png --output social/linkedin-banner.png \
  extract 218 0 1584 396
pnpm dlx -s sharp-cli --input og.svg --output social/youtube-banner.png resize 2560 1344
pnpm dlx -s sharp-cli --input og.svg --output social/discord-invite.png resize 960 540
```

## Notes

- All PNGs use `#0E1012` (Pacelore ink-900) for solid backgrounds.
- All wordmark + accent uses `#C8FA1F` (Pacelore volt accent).
- Existing `apps/web/public/og.png` (1200×630) is the OG card used in `<meta property="og:image">`. Don't replace from this folder.
- Existing `apps/web/public/apple-touch-icon.png`, `icon-192.png`, `icon-512.png` serve the PWA manifest. Same source SVG as the avatars but live one level up.
