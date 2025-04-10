import puppeteer, { Page } from "puppeteer";
import { setTimeout } from "node:timers/promises";
import fs from "fs/promises";

const STEAM_PROFILE_ID = "76561198153749412";
const BASE_URL = `https://steamcommunity.com/profiles/${STEAM_PROFILE_ID}/screenshots/`;

interface ScreenshotData {
  game: string;
  url: string;
}

async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  });
}

async function scrapeSteamScreenshots() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(BASE_URL, { waitUntil: "networkidle2" });

  // Get all game filter options (custom dropdown entries)
  const gameOptions = await page.$$eval(
    "#sharedfiles_filterselect_app_filterable > div",
    (divs) =>
      divs.map((div) => ({
        label: div.textContent?.trim() || "",
        elementId: div.id, // each game div has a unique id like "app_730"
      }))
  );

  const results: ScreenshotData[] = [];

  console.log("gameOptions", gameOptions);
  let count = 0;

  for (const { label: gameName, elementId } of gameOptions) {
    if (count === 1) break; // Limit to 1 game for testing, remove this line to scrape all games

    count++;
    console.log(`🎮 Scraping screenshots for: ${gameName}`);

    // Open the dropdown
    await page.click("#sharedfiles_filterselect_app_activeoption");
    // Click the game filter option
    await page.waitForSelector("#sharedfiles_filterselect_app_filterable", {
      visible: true,
    });

    // Now you can click the specific game option
    await page.click(`#${elementId}`);
    await setTimeout(2000); // wait for AJAX refresh

    // Handle infinite scroll
    let prevHeight = 0;
    let attempts = 0;
    while (attempts < 10) {
      const currentHeight = (await page.evaluate(
        "document.body.scrollHeight"
      )) as number;
      if (currentHeight === prevHeight) break;
      prevHeight = currentHeight;
      await autoScroll(page);
      await setTimeout(1000);
      attempts++;
    }

    // Scrape screenshots (same as before)
    const screenshotLinks = await page.$$eval(
      "#BatchScreenshotManagement a",
      (anchors) => anchors.map((a) => (a as HTMLAnchorElement).href)
    );

    for (const link of screenshotLinks) {
      await page.goto(link, { waitUntil: "networkidle2" });

      try {
        const imgUrl = await page.$eval("#ActualMedia", (img) => {
          const full = (img as HTMLImageElement).src;
          return full.split("?")[0]; // Remove query string so image is in full resolution
        });
        results.push({ game: gameName, url: imgUrl });
        console.log(`✅ ${gameName}: ${imgUrl}`);
      } catch {
        console.warn(`⚠️ Failed to get image from: ${link}`);
      }
    }

    // Go back to the main screenshot page for the next game
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  }

  await browser.close();

  // Save results
  await fs.mkdir("./data", { recursive: true });
  await fs.writeFile(
    "./data/screenshots.json",
    JSON.stringify(results, null, 2)
  );
  console.log("📁 Screenshots saved to ./data/screenshots.json");
}

scrapeSteamScreenshots().catch(console.error);
