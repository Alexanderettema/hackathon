# Design System — Subvert the Agent

Based on DO-LOVE Style Guide v1.0 | 2024

---

## Color Palette

| Name          | Hex       | Use                          |
|---------------|-----------|------------------------------|
| Cream         | `#E3D9AE` | Primary background           |
| Slate Black   | `#1B1E2B` | Primary text, dark surfaces  |
| Coral Red     | `#E56E73` | Accent, CTA, danger          |
| Lavender Blue | `#7A8BC6` | Secondary accent, cards      |
| Forest Green  | `#609F7C` | Positive state, third accent |
| Sky Blue      | `#74B2DF` | Info, stats                  |
| Burnt Orange  | `#D45B31` | Warning, shapes              |
| Teal Blue     | `#75B0CF` | Supporting accent            |
| Pink          | `#D29FA3` | Soft accent                  |

### Color rules
- All screen/slide backgrounds: `#E3D9AE` (cream) — never full-page dark
- Primary text: `#1B1E2B` on cream
- `#1B1E2B` is valid as an individual card/component background (not full screen)
- Colorful text: assign one palette color per word/letter for headline variety
- Stat/info boxes: solid palette color backgrounds (coral, lavender, green, etc.)

---

## Typography

**Primary (headings):** Archivo Black  
**Secondary (body, labels):** Archivo 400 / 700  
Google Fonts: `https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:ital,wght@0,400;0,700;1,400&display=swap`

### Scale
| Role         | Size           | Weight       | Other                        |
|--------------|----------------|--------------|------------------------------|
| Display      | clamp(72–148px)| Archivo Black| uppercase, tracking -0.02em  |
| H1           | clamp(44–88px) | Archivo Black| uppercase, tracking -0.025em |
| H2 / Card    | clamp(20–42px) | Archivo Black| uppercase, tracking -0.01em  |
| Eyebrow      | 12px           | Archivo 700  | uppercase, tracking 0.22em   |
| Body         | clamp(14–19px) | Archivo 400  | line-height 1.55–1.65        |
| Label / Tag  | 11–13px        | Archivo 700  | uppercase, tracking 0.18em+  |

---

## Geometric Glyphs

Core to the DO-LOVE system — replace letter forms with shapes.

| Substitution | Shape              | Implementation                                                 |
|--------------|--------------------|----------------------------------------------------------------|
| **O**        | Filled circle      | `<span style="display:inline-block;width:0.78em;height:0.78em;border-radius:50%;background:COLOR;vertical-align:middle">` |
| **V**        | Downward triangle  | CSS border trick or SVG `<polygon points="0,0 1,0 0.5,1">`    |
| **A**        | Triangle (up)      | SVG or border trick inverted                                   |

Assign colors from palette to each glyph — no two adjacent shapes the same color.

---

## Spacing

| Token  | Value  |
|--------|--------|
| `xs`   | 8px    |
| `sm`   | 14px   |
| `md`   | 24px   |
| `lg`   | 36px   |
| `xl`   | 56px   |
| `2xl`  | 72px   |

Page padding: `64px 72px` on desktop.

---

## Components

### Cards
- Border radius: `18–20px`
- Padding: `28–40px`
- Background: one solid palette color
- No borders, no shadows
- Optional: subtle SVG shape in corner at `opacity: 0.15–0.20`

### Pills / Tags
- Border radius: `100px` (fully rounded)
- Padding: `12px 20–24px`
- Font: Archivo 700, uppercase, tracking 0.07em
- Always include a colored dot (`8–10px` circle) as prefix
- Backgrounds: solid palette color

### Stat Boxes
- Background: `rgba(255,255,255,0.05)`
- Border: `1px solid rgba(255,255,255,0.08)`
- Border radius: `14px`
- Use on dark backgrounds only

### CTAs / Links
- No button border-radius style — use underline treatment
- Bottom border: `2.5–3px solid var(--coral)`
- Font: Archivo 700

---

## Decorative Shapes

Use freely as background or section accents:

```css
/* Circle */
width: Npx; height: Npx; border-radius: 50%; background: COLOR;

/* Downward triangle */
width: 0; height: 0;
border-left: Npx solid transparent;
border-right: Npx solid transparent;
border-top: (N*1.8)px solid COLOR;

/* Ghost outline text (large background numbers) */
color: transparent;
-webkit-text-stroke: 2px rgba(255,255,255,0.08);
```

Shapes always use palette colors. Vary sizes: small (44px), medium (56px), large (80px+).

---

## Slide / Screen Layout Pattern

```
[eyebrow label]          ← 12px, uppercase, faded
[BIG HEADLINE]           ← Display or H1
[body copy]              ← max-width 520–680px
[content row]            ← cards / pills / stats
[bottom row]             ← shapes left + CTA right
```

All screens use cream `#E3D9AE` background. Use card colors and bold type for contrast.

---

## Do / Don't

| Do | Don't |
|----|-------|
| Assign each headline word a different palette color | Use more than 3 colors in a single card |
| Use Arquivo Black at large sizes, all caps | Mix font families beyond Archivo |
| Replace O/V/A with geometric shapes in display text | Add drop shadows or gradients |
| Keep layouts asymmetric and text-heavy | Center-align body copy |
| Use cream `#E3D9AE` as the warm neutral | Use pure white `#FFFFFF` as background |
