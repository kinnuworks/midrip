# Style spec: Linux Man Pages -- Dash Dash
https://dashdash.io/  (measured 2026-11-26, 1440 px wide; page 5778px tall)

Look at hero-1440.png, sections/*.png and phone-375.png next to this. Numbers say what the system is; the screenshots say how it feels.

## Type
- Display (h1): Atilla Sans 192px / 900, line height 1.5, tracking 0em, uppercase, colour #ffffff — "Dash Dash"
- Headings: Inter 32px / 400, line height 1.5, tracking 0em, colour #000000 — "With the rise of software, Dash Dash exists to bri"
- Body: Inter 18px / 400, line height 1.5, tracking 0em, colour #000000 — "Instead of having to take the red pill and become "
- UI (buttons, nav, links): Inter 16px / 400, line height 1.5, tracking 0em, colour #ffffff — "Technical documentation often looks and feels inti"
- Mono: Simplon Mono 32px / 400, line height 1.5, tracking 0.05em, colour #ffffff — "General Commands"
- Families by amount of text: Inter (1808), Simplon Mono (422), Atilla Sans (98)
- Sizes in use, largest first: 256px 900 uppercase (div), 192px 900 uppercase (span), 160px 400 (div), 72px 700 (h2), 48px 400 (a), 32px 400 (div), 28px 400 (h1), 18px 400 (p), 16px 400 (span), 14px 400 uppercase (a), 12px 400 uppercase (td)
- Labels: 5 tracked all-caps, 30 small mono, 0 "A · B" strings, 0 numbered markers, 0 arrow links
- Phone (375): display 80px, body 18px
- Paid or custom fonts: use the free match in ~/.claude/skills/hackathon-design/fonts.md and say which; compare candidates with `shoot.mjs specimen`.

## Colour
- Page: #000000
- Backgrounds, share of painted area: #ffffff 57.0%, #000000 42.9%, #e162a5 0.0%, #c94b4d 0.0%, #e76f3f 0.0%, #e8b74d 0.0%, #499c8c 0.0%, #6ad4dd 0.0%
- Text colours by amount: #ffffff (1140), #000000 (1009), #777777 (179)
- Borders: 1px #e162a5 ×5, 1px #321f99 ×4, 1px #333333 ×1, 1px #499c8c ×1
- Gradients: #000000→#000000 (94% of a screen)

## Shape and depth
- Corner radii on boxes: 0px ×28
- Shadows: none
- Effects: 0 blurred surfaces, 0 gradient text, 2 animated elements; transitions 0.25s, 0.4s, 0.8s

## Components
- Primary button: none found
- Secondary button: none found
- Input: none on the page
- Cards and panels: none
- Nav: none found

## First screen, piece by piece (build ours slot for slot)
- Page colour: #000000
- Header: none
- Pill above the headline: none
- Headline: 1 lines, 1 words, 192px
- Text under the headline: 8 lines, about 56 words, 16px, in 1 block(s)
- Buttons under the headline: none
- Small print before the visual: none
- Main visual: <canvas> 1296×1296 at y=-448, a picture
- Backdrop behind the headline: gradient 1440×844 (draw our own in the same style)
- Accent colours on the first screen: none

## Layout
- Container: 1240px; common gaps ?
- Hero: left, media behind; h1 2 words, 1571px wide at y=224; main visual is a <canvas> 1296×1296 at x=-288, y=-448
- Three equal cards in a row near the top: no
- Sections down the page (see sections/):
  01. y=908, 1764px tall, padding 60/0px, bg page — "Manual Pages"
  02. y=2735, 1059px tall, padding 32/96px, bg #000000 — "Top 10 commands"
  03. y=3826, 672px tall, padding 60/0px, bg page — "Linux commands"
  04. y=4594, 400px tall, padding 64/0px, bg page — "The making of Dash Dash"
  05. y=5058, 720px tall, padding 80/0px, bg #ffffff

## Imagery
- 1 images, 1 SVGs, 0 videos. Large ones: 1a218bef68ca2a32940026379ec3fcd99c637ce7c7ec825a210f3669.png 900×900 at y=4126

Files: design/refs/dashdash/hero-1440.png, full-1440.png, phone-375.png, phone-375-full.png, sections/
