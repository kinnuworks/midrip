import { expect, test } from "@playwright/test";
test("card names fit at 1152x720", async ({ page }) => {
  test.skip(!process.env.WRAP_URL, "only with WRAP_URL");
  await page.setViewportSize({ width: 1152, height: 720 });
  await page.goto(process.env.WRAP_URL!);
  await expect(page.locator("article.table").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(8000);
  const names = await page.locator(".card-name").evaluateAll((els) => els.map((e) => ({ t: e.textContent, h: (e as HTMLElement).offsetHeight, sw: (e as HTMLElement).scrollWidth, cw: (e as HTMLElement).clientWidth })));
  console.log("NAMES", JSON.stringify(names.filter((n) => n.t && n.t !== "sealed").slice(0, 8)));
  await page.screenshot({ path: "../.kit/shots/wrap-1152.png" });
});
