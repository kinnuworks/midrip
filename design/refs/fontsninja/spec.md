# Style spec: Discover, buy and download awesome fonts - Fonts Ninja
https://fonts.ninja/  (measured 2026-11-26, 1440 px wide; page 4801px tall)

Look at hero-1440.png, sections/*.png and phone-375.png next to this. Numbers say what the system is; the screenshots say how it feels.

## Type
- Display (h1): aeonikFont 44px / 400, line height 1.2, tracking -0.011em, colour #121212 — "Your shortcut to better type. Find, test, license "
- Headings: aeonikFont 44px / 400, line height 1.2, tracking -0.011em, colour #121212 — "Your shortcut to better type. Find, test, license "
- Body: aeonikFont 44px / 400, line height 1.2, tracking -0.011em, colour #121212 — "Your shortcut to better type. Find, test, license "
- UI (buttons, nav, links): aeonikFont 14px / 400, line height 1.14, tracking 0em, colour #121212 — "BluHead Studio"
- Mono: none
- Families by amount of text: aeonikFont (1243)
- Sizes in use, largest first: 44px 400 (p), 32px 400 uppercase (fonts-ninja-title), 24px 500 (a), 16px 400 (span), 14px 700 (p), 12px 400 (p)
- Labels: 0 tracked all-caps, 0 small mono, 0 "A · B" strings, 0 numbered markers, 0 arrow links
- Phone (375): display 32px, body 24px
- Paid or custom fonts: use the free match in ~/.claude/skills/hackathon-design/fonts.md and say which; compare candidates with `shoot.mjs specimen`.

## Colour
- Page: #f7f6f6
- Backgrounds, share of painted area: #ffffff 96.8%, #ee585a 3.2%, #d7d7db 0.0%
- Text colours by amount: #121212 (1013), #8e8e93 (165), #fefefe (52), #ee585a (13)
- Borders: 1px #fefefe ×7
- Gradients: none

## Shape and depth
- Corner radii on boxes: pill ×45, 0px ×25, 32px ×24, 16px ×1
- Shadows: `#4b4b4b@0.16 0px 2px 32px 0px` ×17
- Effects: 0 blurred surfaces, 0 gradient text, 24 animated elements; transitions 0.4s, 0.25s, 0.66s, 0.8s

## Components
- Primary button: "Search by vibe": #ee585a on page, text #fefefe, border none, corners pill, 49px tall, 26px side padding, aeonikFont 16px/500, shadow none
- Secondary button: none found
- Input: transparent, border 0px #121212, corners 0px, 18px tall, 16px text
- Cards and panels: bg #ffffff, border none, corners 32px, shadow none, padding 48px (×23)
- Nav: 64px tall, sticky, bg transparent, 12 links, 1440px wide

## First screen, piece by piece (build ours slot for slot)
- Page colour: #f7f6f6
- Header: logo, 3 text links, no button
- Pill above the headline: none
- Headline: 1 lines, 10 words, 44px
- Text under the headline: none
- Buttons under the headline: "Search by vibe" (#ee585a, corners pill)
- Small print before the visual: none
- Main visual: none
- Backdrop behind the headline: none
- Accent colours on the first screen: #ee585a

## Layout
- Container: 1328px; common gaps 6px, 8px, 24px
- Hero: left; h1 10 words, 1328px wide at y=720; no large visual
- Three equal cards in a row near the top: no
- Sections down the page (see sections/):
  01. y=84, 816px tall, padding 7/0px, bg page — "Fonts Ninja"
  02. y=2959, 851px tall, padding 0/0px, bg page

## Imagery
- 44 images, 5 SVGs, 0 videos. Large ones: lob:https://fonts.ninja/7b8f68d4-caa7-42c1-930f-a7c26f0d55d7 771×126 at y=1519; https://fonts.ninja/_next/image 1328×851 at y=2959

## CSS variables on :root
- `--fn-black: #000000`
- `--fn-white: #FFFFFF`
- `--fn-gray2: #8E8E93`
- `--fn-gray7: #121212`
- `--fn-backgroundIllustration: #D9D9D9`
- `--fn-backgroundPage: #F7F6F6`
- `--fn-backgroundScrollNav: #FFFFFF`
- `--fn-backgroundItems: #FFFFFF`
- `--fn-backgroundModalLayout: #12121250`
- `--fn-hairline: rgba(18, 18, 18, 0.12)`
- `--fn-textDefault: #121212`
- `--fn-textDefaultOff: #8E8E93`
- `--fn-textPrimary: #EE585A`
- `--fn-textDeactivated: #8E8E93`
- `--fn-textError: #F0090C`
- `--fn-textOnline: #84E9B1`
- `--fn-textButtonPrimary: #FEFEFE`
- `--fn-textButtonSecondary: #121212`
- `--fn-textButtonBoardOff: #8E8E93`
- `--fn-textButtonBoardOn: #121212`
- `--fn-buttonFillPrimary: #EE585A`
- `--fn-buttonFillPrimaryOver: #DC5153`
- `--fn-buttonFillSecondary: #F1F1F1`
- `--fn-buttonFillSecondaryOver: #D7D7DB`
- `--fn-buttonFillDanger: #F0090C`
- `--fn-buttonFillDangerOver: #FF5052`
- `--fn-buttonBoardStroke: #8E8E93`
- `--fn-buttonDeactivatedStroke: #D7D7DB`
- `--fn-inputStroke: #8E8E93`
- `--fn-colorEffectShadow: #48484a29`
- `--fn-colorEffectShadowSoft: #48484a1a`
- `--fn-avatarBackground: #121212`
- `--fn-avatarUser: #F7F6F6`

Files: design/refs/fontsninja/hero-1440.png, full-1440.png, phone-375.png, phone-375-full.png, sections/
