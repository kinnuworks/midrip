import { expect, test } from "@playwright/test";

// The demo path a judge takes, on devnet and MagicBlock's private rollup, with a fresh browser wallet.
test("join, open, rip, sell the sealed rest on the clock, peek, get bought, verify", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Table 0")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".slot b")).not.toHaveText("0", { timeout: 30_000 });

  await page.getByRole("button", { name: "Get 2,000 play chips" }).click();
  await expect(page.getByText(/Chips: \d+/)).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: /Open a pack/ }).first().click();
  const mine = page.locator("article.table", { hasText: "you hold it" });
  await expect(mine).toBeVisible({ timeout: 30_000 });
  await expect(mine.getByRole("button", { name: "Reveal next card" })).toBeVisible({ timeout: 30_000 });

  for (let i = 0; i < 2; i++) {
    const faceUp = await mine.locator(".card:not(.sealed)").count();
    await mine.getByRole("button", { name: "Reveal next card" }).click();
    await expect(mine.locator(".card:not(.sealed)")).toHaveCount(faceUp + 1, { timeout: 15_000 });
  }

  await mine.getByRole("button", { name: "Sell the sealed rest" }).click();
  const price = mine.locator(".clock .price");
  await expect(price).toBeVisible({ timeout: 15_000 });
  const p1 = Number((await price.innerText()).replace(/\D/g, ""));
  await page.waitForTimeout(1500);
  const p2 = Number((await price.innerText()).replace(/\D/g, ""));
  expect(p2).toBeLessThan(p1);

  await mine.getByRole("button", { name: "Try to read the sealed cards" }).click();
  await expect(mine.getByText(/returned nothing for sealed account/)).toBeVisible({ timeout: 10_000 });

  // The labelled demo bot buys the sealed rest once the clock drops below its average value.
  const id = (await mine.locator(".thead span").first().innerText()).trim();
  const table = page.locator("article.table").filter({ has: page.locator(".thead span", { hasText: new RegExp(`^${id}$`) }) });
  await expect(table.getByText("held by the demo bot")).toBeVisible({ timeout: 60_000 });
  await expect(table.getByText(/Last sale: rest of pack sold for \d+ chips at block \d+/)).toBeVisible();
  await expect(page.getByText(/Sold: The demo bot paid you \d+ chips for the sealed rest/)).toBeVisible();

  const done = page.locator("article.table.done").first();
  await expect(done).toBeVisible({ timeout: 60_000 });
  await done.getByRole("button", { name: "Verify this pack" }).click();
  await expect(done.getByText(/Verified: all 6 cards match/)).toBeVisible();

  // The two cards I revealed before selling are mine: mint them as SPL tokens in this wallet on Solana.
  await page.getByRole("button", { name: "Move my cards to my wallet" }).click();
  await expect(page.getByText(/In your wallet on Solana: .*[1-9]/)).toBeVisible({ timeout: 90_000 });
});
