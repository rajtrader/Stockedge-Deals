
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin());
import axios from 'axios'; 
import dotenv from 'dotenv';

dotenv.config();

const wpApiUrl = 'https://profitbooking.in/wp-json/scraper/v1/stockedge-sector-data'; 

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function extractSectorAndChangePercentage(url) { 
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1200, height: 800 },
     timeout: 0,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled', 
    '--window-size=1920,1080',
    '--start-maximized'
    ],
    ignoreHTTPSErrors: true,
  });
  
  try {
    console.log('Opening new page...');
    const page = await browser.newPage();
    
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log('Starting infinite scroll...');
    await improvedInfiniteScroll(page);
    
    console.log('Extracting data from all loaded items...');
    const results = await page.evaluate(() => {
      const data = [];
      const ionItems = document.querySelectorAll('ion-item[se-item]');
      
      ionItems.forEach((item, index) => {
        try {
          const industryText = item.querySelector('ion-text.normal-font')?.textContent?.trim();
          const stockCountElement = item.querySelector('ion-text.ion-color-se-grey-medium');
          
          let changePercent = '';
          const changePercentElement = item.querySelector('se-price-change-percent-label ion-text');
          if (changePercentElement) {
            changePercent = changePercentElement.textContent.trim();
          }
          
          data.push({
            index: index + 1,
            industry: industryText,
            changePercent: changePercent
          });
        } catch (error) {
          console.error(`Error processing item ${index + 1}:`, error);
        }
      });
      
      return data;
    });
    
    console.log(`Found ${results.length} items total`);
    return results;
  } catch (error) {
    console.error('An error occurred:', error);
    throw error;
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

async function improvedInfiniteScroll(page) {
  console.log('Starting manual-like scrolling...');
  
  let scrollAttempts = 0;
  const maxScrollAttempts = 50;
  let previousItemCount = 0;
  
  while (scrollAttempts < maxScrollAttempts) {
    scrollAttempts++;
    console.log(`Scroll attempt #${scrollAttempts}`);
    
    // Get current item count
    const currentItemCount = await page.evaluate(() => {
      return document.querySelectorAll('ion-item[se-item]').length;
    });
    console.log(`Current items loaded: ${currentItemCount}`);
    
    // Scroll down in smaller increments to trigger lazy loading
    for (let i = 0; i < 10; i++) {
      // Scroll down by 200px
      await page.evaluate(() => {
        window.scrollBy(0, 200);
      });
      
      // Wait a bit between small scrolls
      await delay(1000);
    }
    
    // Wait for content to load
    await delay(3000);
    
    // Get new item count
    const newItemCount = await page.evaluate(() => {
      return document.querySelectorAll('ion-item[se-item]').length;
    });
    
    console.log(`Items after scroll: ${newItemCount}`);
    
    // Check if we got new items
    if (newItemCount > currentItemCount) {
      console.log(`Found ${newItemCount - currentItemCount} new items`);
      previousItemCount = newItemCount;
    } else {
      console.log('No new items loaded, trying different scroll...');
      
      // Try scrolling to specific items
      await page.evaluate(() => {
        const items = document.querySelectorAll('ion-item[se-item]');
        if (items.length > 0) {
          const lastItem = items[items.length - 1];
          lastItem.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      });
      
      await delay(3000);
    }
    
    // Check if we've reached the end
    const isAtBottom = await page.evaluate(() => {
      return window.innerHeight + window.scrollY >= document.body.scrollHeight;
    });
    
    if (isAtBottom) {
      console.log('Reached bottom of page');
      break;
    }
  }
  
  console.log('Finished scrolling');
}

async function main() {
  const targetUrl = 'https://web.stockedge.com/sectors';
  try {
    const data = await extractSectorAndChangePercentage(targetUrl);
    
    console.log('\nExtraction complete!');
    console.log('='.repeat(50));
    
    console.table(data.map(item => ({
      '#': item.index,
      'Sector/Industry': item.industry,
      'Change %': item.changePercent
    })));
    
    for (const item of data) {
      // Fixed field names to match what the API expects
      const wpData = { 
        industry: item.industry,
        change_percent: item.changePercent // Fixed to use changePercent from extracted data
      };
      
      const stored = await storeInWordPress(wpData);
      if (stored) {
        console.log(`Successfully stored "${item.industry}" in WordPress.`);
      } else if (stored?.duplicate) {
        console.log(`Skipped duplicate: "${item.industry}" `);
      } else {
        console.log(`Failed to store "${item.industry}" in WordPress.`);
      }
    }

    return data;
    
  } catch (error) {
    console.error('Failed to extract data:', error);
  }
}

async function storeInWordPress(data) {
  try {
    console.log('Sending to WordPress API:', data);
    const response = await axios.post(wpApiUrl, {
      industry: data.industry,
      change_percent: data.change_percent
    });

    console.log('Stored in WordPress:', response.data);
    return response.data.status === 'duplicate' ? { duplicate: true } : true;
  } catch (error) {
    console.error('WP API Error:', error.response?.data || error.message);
    return false;
  }
}

main();
