# Style spec: Composer by SoFi – Trading. Built Better.
https://www.composer.trade/  (measured 2026-11-26, 1440 px wide; page 11620px tall)

Look at hero-1440.png, sections/*.png and phone-375.png next to this. Numbers say what the system is; the screenshots say how it feels.

## Type
- Display (h1): neue-haas-grotesk-display 244px / 700, line height 1, tracking 0em, colour #000000 — "Composer"
- Headings: neue-haas-grotesk-display 24px / 400, line height 1, tracking 0.025em, colour #000000 — "How do I open a Composer account?"
- Body: neue-haas-grotesk-display 14px / 400, line height 1.43, tracking 0.025em, colour #ffffff — "Ends Dec 7."
- UI (buttons, nav, links): neue-haas-grotesk-display 14px / 400, line height 1.43, tracking 0.025em, colour #ffffff — "Ends Dec 7."
- Mono: none
- Families by amount of text: neue-haas-grotesk-display (8008), Inter (548)
- Sizes in use, largest first: 244px 700 (span), 64px 700 (h1), 36px 400 (div), 32px 400 (p), 24px 400 (div), 20px 400 (p), 16px 400 (div), 14px 500 (span), 12px 500 (span), 10px 400 (div), 9px 400 (div)
- Labels: 0 tracked all-caps, 0 small mono, 1 "A · B" strings, 0 numbered markers, 0 arrow links
- Phone (375): display 68px, body 16px
- Paid or custom fonts: use the free match in ~/.claude/skills/hackathon-design/fonts.md and say which; compare candidates with `shoot.mjs specimen`.

## Colour
- Page: #ffffff
- Backgrounds, share of painted area: #ecedee 52.0%, #ffffff 15.2%, #000000 7.0%, #1c372a 6.3%, #101516 5.0%, #31805a 4.6%, #1871da 4.1%, #f7f7f7 3.5%
- Text colours by amount: #ffffff (4793), #000000 (3610), #e3bc99 (51), #1ec072 (33), #31805a (19), #1871da (14)
- Borders: 1px #000000@0.2 ×22, 1px #000000@0.25 ×12, 1px #bec6cc ×7, 1px #1871da ×6, 1px #101516 ×5
- Gradients: #000000→#000000 (333% of a screen); #ecedee→#000000 (64% of a screen); #000000→#000000 (14% of a screen); #f6609f→#f6609f (4% of a screen); #1871da→#ba84ff→#f6609f (3% of a screen, on text); #f6609f→#f6609f (2% of a screen)

## Shape and depth
- Corner radii on boxes: 0px ×113, pill ×15, 2px ×15, 6px ×14, 12px ×1
- Shadows: `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, #1870db@0.25 0px 1px 2px 0px` ×6; `rgba(0, 0, 0, 0.01) 0px 52.9195px 20.7387px 0px, #000000@0.03 0px 29.3203px 17.8782px 0px, #000000@0.05 0px 12.8723px 12` ×4; `rgba(0, 0, 0, 0.01) 45px 68px 33px 0px, rgba(0, 0, 0, 0.02) 25px 38px 27px 0px, #000000@0.03 11px 17px 20px 0px, #000000` ×2; `rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, #2060df@0.03 54px 82px 39px 0px, #2464db@0.11 31px 4` ×1
- Effects: 0 blurred surfaces, 1 gradient text, 26 animated elements; transitions 0.3s, 0.2s, 0.15s, 0.5s

## Components
- Primary button: "Get started": #000000 on page, text #ffffff, border none, corners pill, 68px tall, 36px side padding, neue-haas-grotesk-display 36px/400, shadow none
- Secondary button: none found
- Input: none on the page
- Cards and panels: bg none, border 1px #000000, corners 9999px, shadow none, padding 0px (×4); bg #000000, border none, corners 0px, shadow none, padding 0px (×3); bg #1ec072, border none, corners 0px, shadow none, padding 0px (×2); bg #1871da, border none, corners 0px, shadow none, padding 0px (×2)
- Nav: 56px tall, relative, bg transparent, 42 links, 1440px wide

## First screen, piece by piece (build ours slot for slot)
- Page colour: #ffffff
- Header: logo, 6 text links, no button
- Pill above the headline: none
- Headline: 1 lines, 1 words, 244px
- Text under the headline: 5 lines, about 19 words, 36px, in 1 block(s)
- Buttons under the headline: "Get started" (#000000, corners pill)
- Small print before the visual: none
- Main visual: <div> 500×200 at y=406, window without a sidebar andout a title bar
- Backdrop behind the headline: gradient (draw our own in the same style)
- Accent colours on the first screen: #1ec072, #1871da, #f6609f, #ffbb38

## Layout
- Container: 1376px; common gaps 4px, 8px, 16px, 40px, 48px
- Hero: split; h1 1 words, 1166px wide at y=332; main visual is a <div> 500×200 at x=-400, y=406
- Three equal cards in a row near the top: no
- Sections down the page (see sections/):
  01. y=0, 900px tall, padding 0/0px, bg page — "Meet
Composer"
  02. y=1002, 377px tall, padding 48/0px, bg #ffffff
  03. y=1379, 1930px tall, padding 190/0px, bg #ecedee — "AI-powered
strategy creation"
  04. y=3309, 762px tall, padding 160/0px, bg #101516 — "Tax-smart active trading in your retirement accoun"
  05. y=4071, 742px tall, padding 160/0px, bg #ecedee — "Start automating your trading today"
  06. y=4813, 3035px tall, padding 96/0px, bg #ecedee — "Customize and
Create"
  07. y=7848, 2012px tall, padding 120/0px, bg #ffffff — "Frequently Asked
Questions"
  08. y=9860, 676px tall, padding 56/40px, bg #000000 — "About Us"
  09. y=10536, 1084px tall, padding 56/56px, bg #1c372a

## Imagery
- 23 images, 75 SVGs, 0 videos. Large ones: https://www.composer.trade/_next/image 734×163 at y=1641; https://www.composer.trade/_next/image 656×442 at y=3469; https://www.composer.trade/_next/image 417×247 at y=4222; https://www.composer.trade/_next/image 1200×990 at y=5304; https://www.composer.trade/_next/image 860×606 at y=6886

Files: design/refs/composer/hero-1440.png, full-1440.png, phone-375.png, phone-375-full.png, sections/
