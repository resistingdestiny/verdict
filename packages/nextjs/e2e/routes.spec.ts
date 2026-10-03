import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Every core route, in both themes, at desktop and phone widths. A page fails on any console error or
 * uncaught exception. Each run saves the screenshot the README uses to docs/img/screenshots.
 */

const ROUTES: ReadonlyArray<readonly [route: string, name: string]> = [
  ["/", "home"],
  ["/market/0", "market-0"],
  ["/create", "create"],
  ["/portfolio", "portfolio"],
  ["/record", "record"],
];
const THEMES = ["light", "dark"] as const;
const SCREENSHOTS = path.resolve(__dirname, "../../../docs/img/screenshots");
// next-themes stores the choice under this localStorage key and sets it on <html data-theme>.
const THEME_KEY = "theme";
// The header's HBAR price comes from CoinGecko, which rate-limits a burst of page loads and then fails
// CORS. The price is not what these tests check, so it is answered locally with a fixed value.
const HBAR_PRICE_URL = "https://api.coingecko.com/api/v3/coins/hedera-hashgraph";
const HBAR_PRICE_USD = 0.05;

for (const theme of THEMES) {
  for (const [route, name] of ROUTES) {
    test(`${route} renders in ${theme} with no console errors`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("console", message => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", error => errors.push(error.message));
      // A failed resource shows in the console without its URL, so record the URL and status as well.
      const failedRequests: string[] = [];
      page.on("response", response => {
        if (response.status() >= 400) failedRequests.push(`HTTP ${response.status()} ${response.url()}`);
      });

      await page.route(HBAR_PRICE_URL, route =>
        route.fulfill({ json: { market_data: { current_price: { usd: HBAR_PRICE_USD } } } }),
      );
      await page.addInitScript(
        ([key, value]) => {
          window.localStorage.setItem(key, value);
        },
        [THEME_KEY, theme] as const,
      );
      await page.goto(route, { waitUntil: "load" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("body")).toBeVisible();
      // Give client components a moment to hydrate and settle before the picture is taken.
      await page.waitForTimeout(1_500);

      const width = testInfo.project.use.viewport?.width ?? 0;
      fs.mkdirSync(SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SCREENSHOTS, `${name}-${theme}-${width}.png`), fullPage: true });

      expect(errors, `console errors on ${route} in ${theme}: ${failedRequests.join(", ")}`).toEqual([]);
    });
  }
}
