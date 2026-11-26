import { expect, test } from "@playwright/test";
// Screenshots of the live first screen for review (desktop and phone).
for (const [name, w, h] of [["desktop", 1440, 900], ["phone", 390, 844]] as const) {
  test(`shot ${name}`, async ({ page }) => {
    test.skip(!process.env.SHOTS, "only when SHOTS=1");
    await page.setViewportSize({ width: w, height: h });
    await page.goto("https://midrip.vercel.app/");
    await expect(page.locator("article.table").first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `../.kit/shots/design-${name}.png` });
  });
}
