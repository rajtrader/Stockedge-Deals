
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin());
import axios from 'axios'; 
import dotenv from 'dotenv';



const wpApiUrl = "https://profitbooking.in/wp-json/scraper/v1/stockedge-bulk-deals"; 

async function scrape() {
  const browser = await puppeteer.launch({

    headless: true, 
    defaultViewport: { width: 1920, height: 1080 },
     timeout: 0,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled', 
    '--window-size=1920,1080'
    ],
    ignoreHTTPSErrors: true,
  }); 
  
  try {
    const page = await browser.newPage();
    console.log('Navigating to StockEdge Deals page...');
    await page.goto('https://web.stockedge.com/deals', { 
      waitUntil: 'networkidle2',
      timeout: 60000 // Increase timeout to 60 seconds
    });
    
    // Get the first date
    const firstDate = await page.evaluate(() => {
      const divider = document.querySelector('ion-item-divider[color="divider-header"]');
      const dateElement = divider ? divider.querySelector('se-date-label ion-text') : null;
      return dateElement ? dateElement.textContent.trim() : 'Unknown date';
    });
    
    console.log(`First date found: ${firstDate}`);
    
    let allTransactions = [];
    let foundSecondDate = false;
    let scrollAttempts = 0;
    const maxScrollAttempts = 5;
    
    while (!foundSecondDate && scrollAttempts < maxScrollAttempts) {
      scrollAttempts++;
      
      // Extract current visible transactions
      const currentTransactions = await page.evaluate((firstDate) => {
        const transactions = [];
        // Get all items including dividers to track position
        const allItems = Array.from(document.querySelectorAll('ion-item[role="listitem"], ion-item-divider[color="divider-header"]'));
        let currentDate = firstDate;
        let isFirstDateSection = true;
        
        allItems.forEach(item => {
          // If this is a divider, update the current date
          if (item.tagName.toLowerCase() === 'ion-item-divider') {
            const dateElement = item.querySelector('se-date-label ion-text');
            const newDate = dateElement ? dateElement.textContent.trim() : currentDate;
            
            if (newDate !== firstDate) {
              isFirstDateSection = false; // We've moved past the first date section
              return;
            }
            
            currentDate = newDate;
            return;
          }
          
          // Only process items from the first date section
          if (!isFirstDateSection) return;
          
          const row = item.querySelector('ion-grid ion-row');
          
          if (!row) return;
          
          const investorElement = row.querySelector('ion-col:nth-child(2) ion-text');
          const statusElement = row.querySelector('ion-col:nth-child(3) ion-chip ion-text');

          const stockNameElement = row.querySelector('ion-col:nth-child(4) ion-text');
          const quantityElement = row.querySelector('ion-col:nth-child(6) ion-text');
          
          transactions.push({
            date: currentDate,
            investor: investorElement ? investorElement.textContent.trim() : 'Unknown',
            status: statusElement ? statusElement.textContent.trim() : 'Unknown',

            stockName: stockNameElement ? stockNameElement.textContent.trim() : 'Unknown',
            quantity: quantityElement ? quantityElement.textContent.trim() : 'Unknown',
          });
        });
        
        return transactions;
      }, firstDate);
      
      // Create a unique key for each transaction to prevent duplicates
      const uniqueTransactions = new Map();
      
      // Add existing transactions to the map
      allTransactions.forEach(t => {
        const key = `${t.investor}-${t.stockName}-${t.quantity}-${t.price}`;
        uniqueTransactions.set(key, t);
      });
      
      // Add new transactions, skipping duplicates
      currentTransactions.forEach(t => {
        const key = `${t.investor}-${t.stockName}-${t.quantity}-${t.price}`;
        if (!uniqueTransactions.has(key)) {
          uniqueTransactions.set(key, t);
        }
      });
      
      // Convert back to array
      allTransactions = Array.from(uniqueTransactions.values());
      
      console.log(`After scroll ${scrollAttempts}: Found ${allTransactions.length} unique transactions`);
      
      // Check for second date divider
      foundSecondDate = await page.evaluate((firstDate) => {
        const dividers = document.querySelectorAll('ion-item-divider[color="divider-header"]');
        for (const divider of dividers) {
          const dateElement = divider.querySelector('se-date-label ion-text');
          const currentDate = dateElement ? dateElement.textContent.trim() : '';
          if (currentDate && currentDate !== firstDate) {
            return true;
          }
        }
        return false;
      }, firstDate);
      
      if (foundSecondDate) {
        console.log(`Found second date divider after ${scrollAttempts} scrolls`);
        break;
      }
      
      // Scroll using Puppeteer's scrollIntoView
      await page.evaluate(() => {
        const lastItem = document.querySelector('ion-item[role="listitem"]:last-child');
        if (lastItem) {
          lastItem.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      });
      
      // Wait for network to be idle and content to load
      await page.waitForFunction(() => {
        return new Promise(resolve => {
          const observer = new MutationObserver(() => {
            resolve(true);
          });
          observer.observe(document.body, { childList: true, subtree: true });
          setTimeout(() => resolve(false), 2000);
        });
      });
    }
    
    if (!foundSecondDate) {
      console.log('Reached maximum scroll attempts without finding a second date');
    }
    
    console.log(`Total unique transactions extracted: ${allTransactions.length}`);
    console.log(allTransactions);
    
    // ADDED: Store data in WordPress
    for (const item of allTransactions) {
      const wpData = { 
        date: item.date,
        investor: item.investor,
        status: item.status,
        stockName: item.stockName,
        quantity: item.quantity,
        
      };
      
      const stored = await storeInWordPress(wpData);
      if (stored) {
        console.log(`Successfully stored "${item.stockName}" in WordPress.`);
      } else if (stored?.duplicate) {
        console.log(`Skipped duplicate: "${item.stockName}"`);
      } else {
        console.log(`Failed to store "${item.stockName}" in WordPress.`);
      }
    }
    
    return allTransactions;
  }
  catch (error) {
    console.error('Error during scraping:', error);
  }
  finally {
    await browser.close();
  }
}

async function storeInWordPress(data) {
  try {
    const response = await axios.post(wpApiUrl, {
      date: data.date,
      investor: data.investor,
      status: data.status,
      stockName: data.stockName,
      quantity: data.quantity,

    });

    console.log('Stored in WordPress:', response.data);
    return true;
  } catch (error) {
    console.error('WP API Error:', error.response?.data || error.message);
    return false;
  }
}

scrape();

export default scrape;
