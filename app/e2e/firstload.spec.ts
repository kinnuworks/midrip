import { expect, test } from "@playwright/test";
// How long a fresh visitor waits before the live tables show.
for (let i = 0; i < (process.env.FIRSTLOAD ? 3 : 0); i++) {
  test(`first load ${i + 1}`, async ({ page }) => {
    const t0 = Date.now();
    await page.goto("https://midrip.vercel.app/?bot=off");
    await expect(page.getByText("Connecting to MagicBlock")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("article.table").first()).toBeVisible({ timeout: 60_000 });
    console.log(`FIRSTLOAD ${Date.now() - t0} ms`);
  });
}
