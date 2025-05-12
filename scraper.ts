import puppeteer, { Page } from "puppeteer";
import { setTimeout } from "node:timers/promises";
import fs from "fs/promises";
import readline from "readline";

// Create readline interface for user interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const STEAM_PROFILE_ID = "76561198153749412";
const BASE_URL = `https://steamcommunity.com/profiles/${STEAM_PROFILE_ID}/screenshots/`;

interface ScreenshotData {
  gameId: string;
  url: string;
}

interface Game {
  id: string;
  name: string;
}

// Utility function to extract game ID from URL
function extractGameId(url: string): string | null {
  const match = url.match(/appid=(\d+)/);
  return match ? match[1] : null;
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
  const browser = await puppeteer.launch({ headless: true });
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

  const screenshots: ScreenshotData[] = [];
  const games: Record<string, Game> = {};

  // Prompt user for game selection
  console.log("Found the following games:");
  gameOptions.forEach((game, i) => {
    console.log(`${i + 1}. ${game.label}`);
  });

  const gamesToScrape = await new Promise<
    { label: string; elementId: string }[]
  >((resolve) => {
    rl.question(
      "Do you want to scrape all games or select a specific one? (all/number): ",
      (answer) => {
        if (answer.toLowerCase() === "all") {
          resolve(gameOptions);
        } else {
          const index = parseInt(answer) - 1;
          if (isNaN(index) || index < 0 || index >= gameOptions.length) {
            console.log("Invalid selection. Defaulting to all games.");
            resolve(gameOptions);
          } else {
            resolve([gameOptions[index]]);
          }
        }
      }
    );
  });

  for (const { label: gameName, elementId } of gamesToScrape) {
    console.log(`🎮 Scraping screenshots for: ${gameName}`);

    // Extract game ID from the elementId (format: "app_730")
    const gameIdFromElement = elementId.replace("app_", "");

    // Open the dropdown
    await page.click("#sharedfiles_filterselect_app_activeoption");
    // Click the game filter option
    await page.waitForSelector("#sharedfiles_filterselect_app_filterable", {
      visible: true,
    });

    // Now you can click the specific game option
    await page.click(`#${elementId}`);
    await setTimeout(2000); // wait for AJAX refresh

    // Get the current URL to extract the game ID
    const currentUrl = page.url();
    const gameId = extractGameId(currentUrl) || gameIdFromElement;

    // Add to games mapping
    if (gameId && !games[gameId]) {
      games[gameId] = { id: gameId, name: gameName };
    }

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

        screenshots.push({ gameId, url: imgUrl });
        console.log(`✅ ${gameName} (ID: ${gameId}): ${imgUrl}`);
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

  // Save screenshots data
  await fs.writeFile(
    "./data/screenshots.json",
    JSON.stringify(screenshots, null, 2)
  );
  console.log("📁 Screenshots saved to ./data/screenshots.json");

  // Save games data
  await fs.writeFile(
    "./data/games.json",
    JSON.stringify(Object.values(games), null, 2)
  );
  console.log("📁 Games data saved to ./data/games.json");

  // Close readline interface
  rl.close();
}

scrapeSteamScreenshots().catch(console.error);
