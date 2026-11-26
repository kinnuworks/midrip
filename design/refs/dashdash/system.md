# Dash Dash: system (direction C)

- Type: display Atilla Sans 192-256px/900 uppercase, wide; free match Archivo 900 at width 125 (specimen: Archivo is the closest wide heavy grotesk). Headings 72px/700 in the same family. Mono Simplon Mono; free match JetBrains Mono, 32px for the hero subtitle, 12-14px tracked caps for labels and table heads (raised to 13px). Body Inter 16-18px (the reference's own; Hanken Grotesk offered as a swap since Inter reads as AI).
- Colour: hero and rail #000000, content bands #ffffff, tiles #000000 with white text, muted #777777 (raised to #8a8a8a on black). Rule colours on tile tops and table rows: pink #e162a5, red #c94b4d, orange #e76f3f, yellow #e8b74d, teal #499c8c, cyan #6ad4dd, indigo #321f99. Halftone in gold #e8b74d to olive.
- Space: container 1240px, left rail 88px; sections 60-96px padding.
- Shape: 0 radius everywhere, no shadows; 4px coloured top rule on tiles; 1px coloured row rules in tables.
- Components: black tiles (label in mono top-left, giant numeral top-right, title in mono at the bottom); data table with mono column heads, giant grey mono first column, Inter description, tracked mono numbers right-aligned; vertical rail with MENU, the name and the year.
- First screen slot for slot: rail (MENU + search, vertical name, year) -> MENU links, vertical "MID-RIP", "DEVNET". Top-right mono link -> live rollup block counter. Halftone canvas -> our own gold halftone (foil) drawn in CSS. Cropped giant headline -> "MID-RIP". Mono subtitle 32px -> tagline. Paragraph -> brief's sub. Below the hero: the live table as the first black tile, two tiles wide, price as the giant numeral.
- Sections: 01 "Manual Pages" tile grid -> tables; 02 black "Top 10 commands" table -> transactions; 03 white list -> proof; 04 "making of" -> how it works.
- Decoration: halftone dot field; made in CSS with radial gradients. Moves: none.
