#!/usr/bin/env node

/**
 * Simple Token Price Testing Script
 * This script tests token price fetching without complex initialization
 */

const { SimplePriceBasedTradingService } = require('./simplePriceBasedTradingService');

class SimpleTokenPriceTester {
  constructor() {
    this.tradingService = new SimplePriceBasedTradingService();
    this.publicClient = this.tradingService.publicClient;
    this.FOUR_MEME_CONTRACT = '0x5c952063c7fc8610ffdb798152d69f0b9550762b';
    this.lastScannedBlock = 0;
    this.scannedTokens = new Set();
    this.cachedBNBPrice = 1000; // Default fallback
    this.lastBNBPriceUpdate = 0;
    this.BNB_PRICE_CACHE_DURATION = 60000; // 1 minute cache
    
    // Rate limiting and batching
    this.priceUpdateQueue = [];
    this.isProcessingQueue = false;
    this.maxConcurrentRequests = 5; // Limit concurrent requests
    this.requestDelay = 200; // 200ms delay between batches
    this.tokenPriceCache = new Map(); // Cache token prices
    this.priceCacheDuration = 2000; // 2 seconds cache for token prices
  }

  async start() {
    console.log('🧪 Starting Simple Token Price Testing...');
    console.log('='.repeat(60));
    
    try {
      // Load wallets
      await this.tradingService.loadAvailableWallets();
      console.log('✅ Wallets loaded');
      
      // Get current block
      const currentBlock = Number(await this.publicClient.getBlockNumber());
      this.lastScannedBlock = currentBlock - 10; // Start 10 blocks back
      console.log(`📊 Starting scan from block: ${this.lastScannedBlock}`);
      console.log(`📊 Current block: ${currentBlock}`);
      
      // Start scanning
      this.startScanning();
      
      console.log('🔍 Scanning for new tokens and logging prices...');
      console.log('Press Ctrl+C to stop');
      console.log('='.repeat(60));
      
    } catch (error) {
      console.error('❌ Failed to start:', error);
    }
  }

  startScanning() {
    // Scan every 5 seconds
    this.scanInterval = setInterval(async () => {
      await this.scanForNewTokens();
    }, 5000);

    // Update prices every 1 second
    this.priceInterval = setInterval(async () => {
      await this.updatePrices();
    }, 1000);
  }

  async scanForNewTokens() {
    try {
      const latestBlock = Number(await this.publicClient.getBlockNumber());
      if (latestBlock <= this.lastScannedBlock) {
        return;
      }

      const fromBlock = this.lastScannedBlock + 1;
      const toBlock = Math.min(latestBlock, fromBlock + 5); // Scan max 5 blocks at a time

      console.log(`🔍 Scanning blocks ${fromBlock} to ${toBlock}...`);

      for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
        const block = await this.publicClient.getBlock({
          blockNumber: BigInt(blockNum),
          includeTransactions: true
        });

        for (const tx of block.transactions) {
          if (tx.to && tx.to.toLowerCase() === this.FOUR_MEME_CONTRACT.toLowerCase()) {
            // Check if this is a createToken transaction
            if (tx.input && tx.input.startsWith('0x519ebb10')) {
              const tokenAddress = await this.extractTokenAddressFromLogs(tx);
              if (tokenAddress && !this.scannedTokens.has(tokenAddress.toLowerCase())) {
                console.log(`\n✨ NEW TOKEN DETECTED: ${tokenAddress}`);
                console.log(`   Block: ${blockNum}, TX: ${tx.hash}`);
                console.log(`   Method: createToken (0x519ebb10)`);
                this.scannedTokens.add(tokenAddress.toLowerCase());
                
                // Immediately check price
                await this.checkTokenPrice(tokenAddress);
              }
            }
          }
        }
      }
      this.lastScannedBlock = toBlock;
    } catch (error) {
      console.error('❌ Error scanning:', error.message);
    }
  }

  async updatePrices() {
    if (this.scannedTokens.size === 0) {
      return;
    }

    console.log(`\n📊 Updating prices for ${this.scannedTokens.size} tokens...`);
    
    // Add tokens to queue for batched processing
    for (const tokenAddress of this.scannedTokens) {
      this.priceUpdateQueue.push(tokenAddress);
    }
    
    // Process queue if not already processing
    if (!this.isProcessingQueue) {
      this.processPriceQueue();
    }
  }

  async processPriceQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    
    while (this.priceUpdateQueue.length > 0) {
      const batch = this.priceUpdateQueue.splice(0, this.maxConcurrentRequests);
      
      console.log(`   🔄 Processing batch of ${batch.length} tokens...`);
      
      // Process batch concurrently
      const promises = batch.map(tokenAddress => this.checkTokenPriceWithCache(tokenAddress));
      await Promise.allSettled(promises);
      
      // Delay between batches to respect rate limits
      if (this.priceUpdateQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.requestDelay));
      }
    }
    
    this.isProcessingQueue = false;
  }

  async checkTokenPriceWithCache(tokenAddress) {
    const now = Date.now();
    const cached = this.tokenPriceCache.get(tokenAddress);
    
    // Check if we have valid cached price
    if (cached && (now - cached.timestamp) < this.priceCacheDuration) {
      console.log(`   💰 ${tokenAddress} (cached): $${cached.priceUSD.toFixed(8)}`);
      return cached;
    }
    
    // Cache expired or doesn't exist, fetch new price
    const result = await this.checkTokenPrice(tokenAddress);
    if (result && result.success) {
      // Store with timestamp for cache management
      this.tokenPriceCache.set(tokenAddress, {
        ...result.data,
        timestamp: now
      });
    }
    return result;
  }

  async checkTokenPrice(tokenAddress) {
    try {
      const priceResult = await this.getFourMemeExactPrice(tokenAddress);
      
      if (priceResult.success && priceResult.data) {
        const { buyPrice, sellPrice, avgPrice, priceUSD } = priceResult.data;
        
        console.log(`💰 ${tokenAddress}`);
        console.log(`   Buy:  ${buyPrice.toFixed(8)} BNB ($${priceUSD.toFixed(8)})`);
        console.log(`   Sell: ${sellPrice.toFixed(8)} BNB`);
        console.log(`   Avg:  ${avgPrice.toFixed(8)} BNB`);
        
        // Check thresholds
        const config = this.tradingService.getConfig();
        const currentBNBPrice = await this.getCachedBNBPrice();
        const migrationPriceUSD = config.trading.migrationPriceBNB * currentBNBPrice;
        
        if (priceUSD > config.trading.lowThresholdUSD) {
          console.log(`   🟢 ABOVE LOW THRESHOLD ($${config.trading.lowThresholdUSD})`);
        }
        if (priceUSD > config.trading.highThresholdUSD) {
          console.log(`   🔴 ABOVE HIGH THRESHOLD ($${config.trading.highThresholdUSD})`);
        }
        if (priceUSD >= migrationPriceUSD) {
          console.log(`   🚨 AT MIGRATION PRICE ($${migrationPriceUSD.toFixed(8)})`);
        }
        
      } else {
        console.log(`❌ ${tokenAddress}: ${priceResult.error}`);
      }
    } catch (error) {
      console.error(`❌ Error checking ${tokenAddress}:`, error.message);
    }
  }

  async extractTokenAddressFromLogs(tx) {
    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash: tx.hash });
      if (!receipt || !receipt.logs) return null;

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === this.FOUR_MEME_CONTRACT.toLowerCase()) {
          if (log.data && log.data.length >= 130) {
            const secondChunk = log.data.slice(66, 130);
            const tokenAddress = '0x' + secondChunk.slice(24);
            if (tokenAddress !== '0x0000000000000000000000000000000000000000' && tokenAddress.length === 42) {
              return tokenAddress.toLowerCase();
            }
          }
          if (log.data && log.data.length >= 66) {
            const firstChunk = log.data.slice(2, 66);
            const tokenAddress = '0x' + firstChunk.slice(24);
            if (tokenAddress !== '0x0000000000000000000000000000000000000000' && tokenAddress.length === 42) {
              return tokenAddress.toLowerCase();
            }
          }
        }
      }
      if (receipt.contractAddress) {
        return receipt.contractAddress.toLowerCase();
      }
      return null;
    } catch (error) {
      console.error(`Error extracting token address from logs for TX ${tx.hash}:`, error.message);
      return null;
    }
  }

  async getFourMemeExactPrice(tokenAddress) {
    try {
      const TOKEN_MANAGER_HELPER = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
      const TOKEN_MANAGER_HELPER_ABI = [
        {
          "inputs": [
            {"name": "token", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "funds", "type": "uint256"}
          ],
          "name": "tryBuy",
          "outputs": [
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"}
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {"name": "token", "type": "address"},
            {"name": "amount", "type": "uint256"}
          ],
          "name": "trySell",
          "outputs": [
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"}
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {"name": "token", "type": "address"}
          ],
          "name": "getTokenInfo",
          "outputs": [
            {"name": "version", "type": "uint256"},
            {"name": "tokenManager", "type": "address"},
            {"name": "quote", "type": "address"},
            {"name": "lastPrice", "type": "uint256"},
            {"name": "tradingFeeRate", "type": "uint256"},
            {"name": "minTradingFee", "type": "uint256"},
            {"name": "launchTime", "type": "uint256"},
            {"name": "offers", "type": "uint256"},
            {"name": "maxOffers", "type": "uint256"},
            {"name": "funds", "type": "uint256"},
            {"name": "maxFunds", "type": "uint256"},
            {"name": "liquidityAdded", "type": "bool"}
          ],
          "stateMutability": "view",
          "type": "function"
        }
      ];

      // First, try to get token info to check if it's properly initialized
      let tokenInfo = null;
      try {
        const infoResult = await this.publicClient.readContract({
          address: TOKEN_MANAGER_HELPER,
          abi: TOKEN_MANAGER_HELPER_ABI,
          functionName: 'getTokenInfo',
          args: [tokenAddress]
        });
        
        if (infoResult && infoResult.length >= 12) {
          tokenInfo = {
            version: Number(infoResult[0]),
            tokenManager: infoResult[1],
            quote: infoResult[2],
            lastPrice: Number(infoResult[3]),
            tradingFeeRate: Number(infoResult[4]),
            minTradingFee: Number(infoResult[5]),
            launchTime: Number(infoResult[6]),
            offers: Number(infoResult[7]),
            maxOffers: Number(infoResult[8]),
            funds: Number(infoResult[9]),
            maxFunds: Number(infoResult[10]),
            liquidityAdded: Boolean(infoResult[11])
          };
          
          console.log(`   Token Info: Version ${tokenInfo.version}, Funds: ${(tokenInfo.funds/1e18).toFixed(6)} BNB, Liquidity: ${tokenInfo.liquidityAdded}`);
          console.log(`   LastPrice: ${(tokenInfo.lastPrice/1e18).toFixed(8)} BNB`);
        }
      } catch (error) {
        console.log(`   ⚠️ Could not get token info: ${error.message}`);
      }

      // Use token info lastPrice as the primary price source
      if (tokenInfo && tokenInfo.lastPrice > 0) {
        const realPrice = Number(tokenInfo.lastPrice) / 1e18;
        const bnbPriceUSD = await this.getCachedBNBPrice();
        const priceUSD = realPrice * bnbPriceUSD;
        console.log(`   Using lastPrice: ${realPrice.toFixed(8)} BNB ($${priceUSD.toFixed(8)})`);
        console.log(`   BNB Price (cached): $${bnbPriceUSD.toFixed(2)}`);
        
        // Also try to get more accurate prices using simulations
        try {
          const buyAmount = BigInt(1e18); // 1 BNB
          const sellAmount = BigInt(1000000 * 1e18); // 1M tokens
          
          // Try buy simulation
          const buyResult = await this.publicClient.readContract({
            address: TOKEN_MANAGER_HELPER,
            abi: TOKEN_MANAGER_HELPER_ABI,
            functionName: 'tryBuy',
            args: [tokenAddress, buyAmount, buyAmount]
          });
          
          // Try sell simulation
          const sellResult = await this.publicClient.readContract({
            address: TOKEN_MANAGER_HELPER,
            abi: TOKEN_MANAGER_HELPER_ABI,
            functionName: 'trySell',
            args: [tokenAddress, sellAmount]
          });
          
          if (buyResult && sellResult) {
            const buyPrice = Number(buyResult[0]) / 1e18; // tokens received per BNB
            const sellPrice = Number(sellResult[0]) / 1e18; // BNB received per token
            const avgPrice = (buyPrice + sellPrice) / 2;
            const avgPriceUSD = avgPrice * bnbPriceUSD;
            
            console.log(`   Simulation - Buy: ${buyPrice.toFixed(8)} tokens/BNB`);
            console.log(`   Simulation - Sell: ${sellPrice.toFixed(8)} BNB/token`);
            console.log(`   Simulation - Avg: ${avgPrice.toFixed(8)} BNB ($${avgPriceUSD.toFixed(8)})`);
            
            // Use simulation price if it's more recent/accurate
            if (avgPrice > 0) {
              return { success: true, data: { buyPrice: avgPrice, sellPrice: avgPrice, avgPrice: avgPrice, priceUSD: avgPriceUSD } };
            }
          }
        } catch (simError) {
          console.log(`   ⚠️ Simulation failed: ${simError.message}`);
        }
        
        // Fallback to lastPrice
        return { success: true, data: { buyPrice: realPrice, sellPrice: realPrice, avgPrice: realPrice, priceUSD } };
      }

      return { success: false, error: 'Token may be too new or not have liquidity yet' };

    } catch (error) {
      console.error(`❌ Error getting exact price for ${tokenAddress}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async getCachedBNBPrice() {
    const now = Date.now();
    
    // Check if cache is still valid (1 minute)
    if (now - this.lastBNBPriceUpdate < this.BNB_PRICE_CACHE_DURATION) {
      return this.cachedBNBPrice;
    }
    
    // Cache expired, fetch new price
    try {
      console.log('   🔄 Updating BNB price cache...');
      const newPrice = await this.getRealBNBPrice();
      this.cachedBNBPrice = newPrice;
      this.lastBNBPriceUpdate = now;
      console.log(`   ✅ BNB price updated: $${newPrice.toFixed(2)}`);
      return newPrice;
    } catch (error) {
      console.log(`   ⚠️ Failed to update BNB price, using cached: $${this.cachedBNBPrice.toFixed(2)}`);
      return this.cachedBNBPrice;
    }
  }

  async getRealBNBPrice() {
    try {
      const PANCAKESWAP_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
      const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
      const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
      
      const PANCAKESWAP_ROUTER_ABI = [
        {
          'inputs': [
            {'name': 'amountIn', 'type': 'uint256'},
            {'name': 'path', 'type': 'address[]'}
          ],
          'name': 'getAmountsOut',
          'outputs': [
            {'name': 'amounts', 'type': 'uint256[]'}
          ],
          'stateMutability': 'view',
          'type': 'function'
        }
      ];
      
      const amountsOut = await this.publicClient.readContract({
        address: PANCAKESWAP_ROUTER_V2,
        abi: PANCAKESWAP_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [
          BigInt(1e18), // 1 BNB
          [WBNB_ADDRESS, USDT_ADDRESS] // WBNB -> USDT
        ]
      });
      
      if (amountsOut && amountsOut.length >= 2) {
        return Number(amountsOut[1]) / 1e18;
      }
      
      return 1000; // Fallback BNB price
    } catch (error) {
      console.log(`   ⚠️ Could not get BNB price: ${error.message}`);
      return 1000; // Fallback BNB price
    }
  }

  async getTokenDecimals(tokenAddress) {
    try {
      const ERC20_ABI = [
        {
          "inputs": [],
          "name": "decimals",
          "outputs": [{"name": "", "type": "uint8"}],
          "stateMutability": "view",
          "type": "function"
        }
      ];
      const decimals = await this.publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'decimals'
      });
      return Number(decimals);
    } catch (error) {
      return 18; // Default to 18 decimals
    }
  }

  stop() {
    console.log('\n🛑 Stopping Token Price Testing...');
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    
    if (this.priceInterval) {
      clearInterval(this.priceInterval);
      this.priceInterval = null;
    }
    
    console.log('✅ Token Price Testing stopped.');
    console.log(`📊 Total tokens scanned: ${this.scannedTokens.size}`);
  }
}

// Start the tester
const tester = new SimpleTokenPriceTester();
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
