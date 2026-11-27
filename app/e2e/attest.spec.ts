import { expect, test } from "@playwright/test";
test("header shows blocks per second and TEE attestation; live stats render", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("article.table").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".slot")).toContainText(/blocks\/s/, { timeout: 20_000 });
  await expect(page.locator(".slot")).toContainText("TEE attested", { timeout: 30_000 });
  await expect(page.getByText(/Live on devnet: \d+ packs opened across \d+ tables/)).toBeVisible();
  console.log("SLOT", await page.locator(".slot").innerText());
  await page.screenshot({ path: "../.kit/shots/improve-local.png" });
});
