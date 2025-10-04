#!/usr/bin/env node

/**
 * Token Price Testing Script
 * This script scans for new tokens and logs their prices for testing
 */

const { SimplePriceBasedTradingService } = require('./simplePriceBasedTradingService');

class TokenPriceTester {
  constructor() {
    this.tradingService = new SimplePriceBasedTradingService();
    this.isRunning = false;
    this.scannedTokens = new Set();
  }

  async start() {
    if (this.isRunning) {
      console.log('⚠️ Price tester is already running.');
      return;
    }

    console.log('🧪 Starting Token Price Testing...');
    console.log('='.repeat(60));
    this.isRunning = true;

    try {
      // Initialize the trading service
      await this.tradingService.loadAvailableWallets();
      await this.tradingService.updateBNBPriceUSD();
      this.tradingService.lastScannedBlock = Number(await this.tradingService.publicClient.getBlockNumber()) - 10;
      
      console.log('✅ Trading service initialized');
      console.log(`   Starting scan from block: ${this.tradingService.lastScannedBlock}`);
      console.log(`   Current BNB Price: $${this.tradingService.bnbPriceUSD.toFixed(2)}`);
      
      // Start scanning for new tokens
      this.startTokenScanning();
      
      console.log('🔍 Scanning for new tokens and logging prices...');
      console.log('Press Ctrl+C to stop');
      console.log('='.repeat(60));
      
    } catch (error) {
      console.error('❌ Failed to start price tester:', error);
      this.stop();
    }
  }

  startTokenScanning() {
    // Scan for new tokens every 5 seconds
    this.scanInterval = setInterval(async () => {
      await this.scanForNewTokens();
    }, 5000);

    // Update prices every 2 seconds
    this.priceInterval = setInterval(async () => {
      await this.updateTokenPrices();
    }, 2000);
  }

  async scanForNewTokens() {
    try {
      const latestBlock = Number(await this.tradingService.publicClient.getBlockNumber());
      if (latestBlock <= this.tradingService.lastScannedBlock) {
        return;
      }

      const fromBlock = this.tradingService.lastScannedBlock + 1;
      const toBlock = latestBlock;

      console.log(`🔍 Scanning blocks ${fromBlock} to ${toBlock} for new tokens...`);

      for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
        const block = await this.tradingService.publicClient.getBlock({
          blockNumber: BigInt(blockNum),
          includeTransactions: true
        });

        for (const tx of block.transactions) {
          if (tx.to && tx.to.toLowerCase() === this.tradingService.FOUR_MEME_CONTRACT.toLowerCase()) {
            const tokenAddress = await this.tradingService.extractTokenAddressFromLogs(tx);
            if (tokenAddress && !this.scannedTokens.has(tokenAddress.toLowerCase())) {
              console.log(`\n✨ NEW TOKEN DETECTED: ${tokenAddress}`);
              console.log(`   Block: ${blockNum}, TX: ${tx.hash}`);
              this.scannedTokens.add(tokenAddress.toLowerCase());
              
              // Immediately get price for the new token
              await this.checkTokenPrice(tokenAddress);
            }
          }
        }
      }
      this.tradingService.lastScannedBlock = toBlock;
    } catch (error) {
      console.error('❌ Error scanning for new tokens:', error.message);
    }
  }

  async updateTokenPrices() {
    if (this.scannedTokens.size === 0) {
      return;
    }

    console.log(`\n📊 Updating prices for ${this.scannedTokens.size} tokens...`);
    
    for (const tokenAddress of this.scannedTokens) {
      await this.checkTokenPrice(tokenAddress);
    }
  }

  async checkTokenPrice(tokenAddress) {
    try {
      const priceResult = await this.tradingService.getFourMemeExactPrice(tokenAddress);
      
      if (priceResult.success && priceResult.data) {
        const { buyPrice, sellPrice, avgPrice, priceUSD } = priceResult.data;
        
        console.log(`💰 ${tokenAddress}`);
        console.log(`   Buy Price:  ${buyPrice.toFixed(8)} BNB ($${(buyPrice * this.tradingService.bnbPriceUSD).toFixed(8)})`);
        console.log(`   Sell Price: ${sellPrice.toFixed(8)} BNB ($${(sellPrice * this.tradingService.bnbPriceUSD).toFixed(8)})`);
        console.log(`   Avg Price:  ${avgPrice.toFixed(8)} BNB ($${priceUSD.toFixed(8)})`);
        
        // Check if price meets thresholds
        const config = this.tradingService.getConfig();
        if (priceUSD > config.trading.lowThresholdUSD) {
          console.log(`   🟢 ABOVE LOW THRESHOLD ($${config.trading.lowThresholdUSD})`);
        }
        if (priceUSD > config.trading.highThresholdUSD) {
          console.log(`   🔴 ABOVE HIGH THRESHOLD ($${config.trading.highThresholdUSD})`);
        }
        if (priceUSD >= config.trading.migrationPriceUSD) {
          console.log(`   🚨 AT MIGRATION PRICE ($${config.trading.migrationPriceUSD})`);
        }
        
      } else {
        console.log(`❌ ${tokenAddress}: Could not get price - ${priceResult.error}`);
      }
    } catch (error) {
      console.error(`❌ Error checking price for ${tokenAddress}:`, error.message);
    }
  }

  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Price tester is not running.');
      return;
    }

    console.log('\n🛑 Stopping Token Price Testing...');
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    
    if (this.priceInterval) {
      clearInterval(this.priceInterval);
      this.priceInterval = null;
    }
    
    this.isRunning = false;
    console.log('✅ Token Price Testing stopped.');
    console.log(`📊 Total tokens scanned: ${this.scannedTokens.size}`);
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      tokensScanned: this.scannedTokens.size,
      scannedTokens: Array.from(this.scannedTokens)
    };
  }
}

// Start the tester
const tester = new TokenPriceTester();
tester.start();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\nReceived SIGINT. Shutting down gracefully...');
  await tester.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\nReceived SIGTERM. Shutting down gracefully...');
  await tester.stop();
  process.exit(0);
});
