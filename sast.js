import puppeteer from 'puppeteer';
import axios from 'axios';

import dotenv from 'dotenv';

dotenv.config();

const wpApiUrl = 'https://profitbooking.in/wp-json/scraper/v1/stockedge-bulk-deals'; 

async function extractStockData() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1200, height: 800 }
  });

  try {
    const page = await browser.newPage();
    await page.goto('https://web.stockedge.com/deals?section=sast-deals', { waitUntil: 'networkidle2' });
    await page.waitForSelector('ion-item-divider[color="divider-header"]');

    let dateHeaders = [];
    let stockData = [];
    let lastPosition = 0;
    const processedDates = new Set();

    const extractItemsData = async () => {
      const dateDividers = await page.$$eval('ion-item-divider[color="divider-header"]', dividers => {
        return dividers.map(div => {
          const dateElement = div.querySelector('se-date-label ion-text');
          return dateElement ? dateElement.textContent.trim() : null;
        });
      });

      dateDividers.forEach(date => {
        if (date && !processedDates.has(date)) {
          processedDates.add(date);
          dateHeaders.push(date);
        }
      });

      const items = await page.$$eval('ion-item.item-bottom-border', items => {
        return items.map(item => {
          // Extract the status (Bought/Sold) from the ion-chip element
          const statusElement = item.querySelector('ion-chip ion-text');
          const status = statusElement ? statusElement.textContent.trim() : '';
          
          const type = item.querySelector('ion-col ion-text.small-font')?.textContent?.trim() || '';

          const cols = item.querySelectorAll('ion-col');

          const investor = cols[0]?.querySelector('ion-text.normal-font')?.textContent?.trim() || '';
          const stockName = cols[2]?.querySelector('ion-text.normal-font')?.textContent?.trim() || '';
          const quantity = cols[3]?.querySelector('ion-text')?.textContent?.trim() || '';
          
          const dateElements = cols[5]?.querySelectorAll('se-date-label ion-text');
          const dateCol = dateElements?.[1]?.textContent?.trim() || dateElements?.[0]?.textContent?.trim() || '';
          
          return {
            investor,
            stockName,
            quantity,
            date: dateCol,
            type,
            status // Added the status field
          };
        });
      });

      items.forEach(item => {
        if (item.type.toLowerCase() !== 'holding post deal') {
          stockData.push(item);
        }
      });
    };

    await extractItemsData();

    while (dateHeaders.length < 2) {
      const currentPosition = await page.evaluate(() => document.documentElement.scrollTop);

      await page.evaluate(() => {
        window.scrollBy(0, 500);
      });
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      await delay(1000);
      await extractItemsData();

      const newPosition = await page.evaluate(() => document.documentElement.scrollTop);
      if (newPosition === lastPosition) {
        console.log('Reached end of page without finding second date divider');
        break;
      }
      lastPosition = newPosition;
    }

    console.log(`Found ${dateHeaders.length} date headers: ${dateHeaders.join(', ')}`);
    console.log(`Found ${stockData.length} stock transactions (excluding holding post deals)`);
    console.log(stockData);

    // Store data in WordPress
    for (const item of stockData) {
      const wpData = { 
        date: item.date,
        investor: item.investor,
        stockName: item.stockName,
        quantity: item.quantity,
        status: item.status // Added status to WordPress data
      };
      
      const stored = await storeInWordPress(wpData);
      if (stored) {
        console.log(`Successfully stored "${item.stockName}" (${item.status}) in WordPress.`);
      } else if (stored?.duplicate) {
        console.log(`Skipped duplicate: "${item.stockName}" (${item.status})`);
      } else {
        console.log(`Failed to store "${item.stockName}" (${item.status}) in WordPress.`);
      }
    }

    return {
      dateDividers: dateHeaders,
      transactions: stockData
    };
  } catch (error) {
    console.error('Error during scraping:', error);
  } finally {
    await browser.close();
  }
}

// WordPress storage function
async function storeInWordPress(data) {
  try {
    const response = await axios.post(wpApiUrl, {
      date: data.date,
      investor: data.investor,
      stockName: data.stockName,
      quantity: data.quantity,
      status: data.status // Added status field to WordPress storage
    });

    console.log('Stored in WordPress:', response.data);
    return true;
  } catch (error) {
    console.error('WP API Error:', error.response?.data || error.message);
    if (error.response?.data?.code === 'duplicate_entry') {
      return { duplicate: true };
    }
    return false;
  }
}

extractStockData().then((result) => {
  console.log('Data extraction complete');
});

export default extractStockData;