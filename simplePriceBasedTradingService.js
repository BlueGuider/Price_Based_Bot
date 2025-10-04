require('dotenv').config();
const { createPublicClient, createWalletClient, http, fallback, formatUnits, parseUnits, encodeFunctionData, maxUint256 } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const crypto = require('crypto');
const { bsc } = require('viem/chains');
const fs = require('fs');
const path = require('path');
const {
  TOKEN_MANAGER_HELPER_ABI,
  TOKEN_MANAGER_V1_ABI,
  TOKEN_MANAGER_V2_ABI,
  ERC20_ABI,
  PANCAKESWAP_V2_ROUTER_ABI
} = require('./abis');
const { loadPatterns, matchPattern } = require('./patternDetection');
const { shouldBuy, shouldSell } = require('./tradingLogic');
const { loadWallets } = require('./walletUtils');
const { loadConfig, saveConfig } = require('./config');

// Simple encryption/decryption utility
class SimpleSecurityUtils {
  static decrypt(encryptedText) {
    // 1) Try simple base64 decoding first (legacy wallets storing raw pk in base64)
    try {
      const decoded = Buffer.from(encryptedText, 'base64').toString('utf8');
      if (decoded.startsWith('0x') && decoded.length === 66) {
        return decoded;
      }
    } catch (_) { }

    // 2) AES-256-GCM with PBKDF2-SHA512 and layout: salt|iv|tag|ciphertext (all binary, base64-wrapped)
    const encryptionKey = process.env.ENCRYPTION_KEY || process.env.FOUR_MEME_WALLET_KEY_PASSPHRASE || '';
    if (!encryptionKey) {
      throw new Error('Missing ENCRYPTION_KEY in .env for decrypting wallet');
    }
    try {
      const combined = Buffer.from(encryptedText, 'base64');
      const SALT_LEN = 32; // bytes
      const IV_LEN = 16;   // bytes
      const TAG_LEN = 16;  // bytes

      if (combined.length <= SALT_LEN + IV_LEN + TAG_LEN) {
        throw new Error('Encrypted payload too short');
      }

      const salt = combined.subarray(0, SALT_LEN);
      const iv = combined.subarray(SALT_LEN, SALT_LEN + IV_LEN);
      const tag = combined.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
      const encrypted = combined.subarray(SALT_LEN + IV_LEN + TAG_LEN);

      const key = crypto.pbkdf2Sync(encryptionKey, salt, 100000, 32, 'sha512');
      // Match user's implementation: use createDecipher (no iv param), set AAD to salt, set tag
      const decipher = crypto.createDecipher('aes-256-gcm', key);
      decipher.setAAD(salt);
      decipher.setAuthTag(tag);
      // Encrypted is binary; per their code they used hex output then Buffer.from(hex), so we can pass buffer directly
      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');
      if (!decrypted.startsWith('0x') || decrypted.length !== 66) {
        throw new Error('Decrypted value is not a valid private key');
      }
      return decrypted;
    } catch (error) {
      throw new Error(`Failed to decrypt wallet with env key: ${error.message}`);
    }
  }
}

/**
 * Simplified Price-Based Trading Service
 * This version doesn't depend on complex TypeScript services
 */

class SimplePriceBasedTradingService {
  constructor() {
    this.config = loadConfig();
    this.patterns = loadPatterns();
    this.monitoredTokens = new Map();
    this.isMonitoring = false;
    this.monitoringInterval = null;
    this.availableWallets = loadWallets(this.config);
    this.activeSellLocks = new Set();
    this.activeBuyLocks = new Set(); // Track tokens currently being bought to prevent duplicate buys
    this.tradedTokens = new Set(); // Track tokens that have been traded to prevent re-trading
    this.tradeStats = {
      totalTrades: 0,
      successfulBuys: 0,
      successfulSells: 0,
      totalProfitUSD: 0,
      tokensMonitored: 0,
      tokensTraded: 0
    };
    this.FOUR_MEME_CONTRACT = '0x5c952063c7fc8610ffdb798152d69f0b9550762b';
    this.SCAN_INTERVAL = 300; // 500ms for fast detection
    this.MAX_BLOCKS_PER_SCAN = 1;
    this.lastProcessedBlock = 0;
    this.scanningInterval = null;
    this.isScanning = false;
    this.bnbPriceUSD = 1000; // Initialize with fallback price
    this.lastBNBPriceUpdate = 0;
    this.warnedUnknownQuote = new Set();

    // RPC transport with fallback across many endpoints (no batching)
    this.rpcUrls = this.parseRpcUrls(process.env.BSC_RPC_URLS, process.env.BSC_RPC_URL);
    this.transport = this.createFallbackTransport(this.rpcUrls);
    console.log('🔌 RPC endpoints configured:', this.rpcUrls);
    this.publicClient = createPublicClient({ chain: bsc, transport: this.transport });

    // Import ABIs from separate file
    this.TOKEN_MANAGER_HELPER_ABI = TOKEN_MANAGER_HELPER_ABI;
    this.TOKEN_MANAGER_V1_ABI = TOKEN_MANAGER_V1_ABI;
    this.TOKEN_MANAGER_V2_ABI = TOKEN_MANAGER_V2_ABI;
    this.ERC20_ABI = ERC20_ABI;
    this.PANCAKESWAP_V2_ROUTER_ABI = PANCAKESWAP_V2_ROUTER_ABI;

    this.TOKEN_MANAGER_HELPER = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
    // Common stablecoins on BSC (treated as $1)
    this.BSC_STABLES = new Set([
      '0x55d398326f99059ff775485246999027b3197955', // USDT (18)
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC (18)
      '0x90c97f71e18723b0cf0dfa30ee176ab653e89f40', // FRAX
      '0xe0e514c71282b6f4e823703a39374cf58dc3ea4f', // BELT USD (legacy)
      '0x1b80eeead41c2ed6cc1f70f76105f0e4e0f76d1c', // TUSD (var)
      '0x1fad948c7f211bcae0d67b2b31c6bd3fa69a3c7f', // USDP
      '0xe0007e25c4d4c8e6aa2f17b84da7b7c8f7c3f2b7', // FDUSD
    ]);

    this.loadAvailableWallets();

    const patternsPath = path.join(__dirname, 'patterns.json');
    let PATTERNS = [];
    try {
      if (fs.existsSync(patternsPath)) {
        const patternsData = fs.readFileSync(patternsPath, 'utf8');
        PATTERNS = JSON.parse(patternsData).patterns.filter(p => p.enabled);
        console.log(`✅ Loaded ${PATTERNS.length} enabled trading patterns.`);
      } else {
        console.log('⚠️ patterns.json not found, no pattern filtering will be applied.');
      }
    } catch (e) {
      console.error('❌ Error loading patterns.json:', e);
    }
  }

  /**
   * Parse RPC URLs from env, accepting comma-separated or JSON array, and cleaning brackets/quotes
   */
  parseRpcUrls(bulkUrlsEnv, singleUrlEnv) {
    const cleaned = [];
    try {
      if (bulkUrlsEnv) {
        // Try JSON array first
        try {
          const asJson = JSON.parse(bulkUrlsEnv);
          if (Array.isArray(asJson)) {
            for (const u of asJson) {
              if (typeof u === 'string' && u.trim()) cleaned.push(u.trim());
            }
          }
        } catch (_) {
          // Fallback: comma-separated, but also strip stray brackets/quotes
          bulkUrlsEnv.split(',').forEach(part => {
            const t = part.replace(/^[\['\s]+|[\]'\s]+$/g, '').trim();
            if (t) cleaned.push(t);
          });
        }
      }
      if (singleUrlEnv && typeof singleUrlEnv === 'string' && singleUrlEnv.trim()) {
        cleaned.push(singleUrlEnv.trim());
      }
    } catch (_) { }
    const unique = Array.from(new Set(cleaned)).filter(u => /^https?:\/\//.test(u));
    if (unique.length === 0) {
      return [
        "https://bsc.meowrpc.com",
        "https://bsc.publicnode.com",
        "https://bsc-rpc.publicnode.com",
        "https://bsc-mainnet.public.blastapi.io",
        "https://bsc-dataseed1.binance.org",
        "https://bsc-dataseed2.binance.org",
        "https://bsc-dataseed3.binance.org",
        "https://bsc-dataseed4.binance.org",
        "https://bsc-dataseed1.defibit.io",
        "https://bsc-dataseed2.defibit.io",
        "https://bsc-dataseed1.ninicoin.io",
        "https://bsc-dataseed2.ninicoin.io",
        "https://bsc-dataseed.binance.org",
        "https://rpc.ankr.com/bsc",
        "https://bsc.api.onfinality.io/public",
        "https://bsc.public.blastapi.io",
        "https://bsc-dataseed5.defibit.io",
        "https://bsc-dataseed6.defibit.io",
        "https://bsc-dataseed3.ninicoin.io",
        "https://bsc-dataseed4.ninicoin.io",
        "https://bsc-dataseed5.ninicoin.io",
        "https://bsc-dataseed6.ninicoin.io"
      ];
    }
    return unique;
  }

  createFallbackTransport(urls) {
    // Seed with provided URLs or defaults, and add additional public endpoints as backup
    const baseUrls = (urls && urls.length ? urls : [
      "https://bsc.meowrpc.com",
      "https://bsc.publicnode.com",
      "https://bsc-rpc.publicnode.com",
      "https://bsc-mainnet.public.blastapi.io",
      "https://bsc-dataseed1.binance.org",
      "https://bsc-dataseed2.binance.org",
      "https://bsc-dataseed3.binance.org",
      "https://bsc-dataseed4.binance.org",
      "https://bsc-dataseed1.defibit.io",
      "https://bsc-dataseed2.defibit.io",
      "https://bsc-dataseed1.ninicoin.io",
      "https://bsc-dataseed2.ninicoin.io",
      "https://bsc-dataseed.binance.org",
      "https://rpc.ankr.com/bsc",
      "https://bsc.api.onfinality.io/public",
      "https://bsc.public.blastapi.io",
      "https://bsc-dataseed5.defibit.io",
      "https://bsc-dataseed6.defibit.io",
      "https://bsc-dataseed3.ninicoin.io",
      "https://bsc-dataseed4.ninicoin.io",
      "https://bsc-dataseed5.ninicoin.io",
      "https://bsc-dataseed6.ninicoin.io",
      'https://1rpc.io/bnb'
    ]);

    const unique = Array.from(new Set(baseUrls)).filter(u => /^https?:\/\//.test(u));
    const transports = unique.map(url => http(url, { timeout: 10000, retryCount: 2, retryDelay: 1000, batch: false }));
    return fallback(transports, { rank: true, retryCount: 3, retryDelay: 2000 });
  }

  rotateRpc(reason) {
    // With fallback transport, explicit rotation is not required; log for visibility
    console.log(`🔁 RPC failover notice: ${reason || 'error'}`);
  }

  async withRpcFailover(fn, retries = Math.min(this.rpcUrls.length, 3)) {
    let attempt = 0;
    let lastError;
    while (attempt < retries) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        this.rotateRpc(e?.message || 'unknown');
        // backoff
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        attempt++;
      }
    }
    throw lastError;
  }

  /**
   * Load configuration from file
   */
  loadConfig() {
    try {
      const configPath = path.join(__dirname, 'price-trading-config.json');
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        console.log('✅ Price trading configuration loaded');
        return JSON.parse(configData);
      } else {
        console.log('⚠️ Config file not found, using default settings');
        const defaultConfig = this.getDefaultConfig();
        this.saveConfig(defaultConfig);
        return defaultConfig;
      }
    } catch (error) {
      console.error('❌ Error loading config:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * Save configuration to file
   */
  saveConfig(config = this.config) {
    try {
      const configPath = path.join(__dirname, 'price-trading-config.json');
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('✅ Configuration saved');
    } catch (error) {
      console.error('❌ Error saving config:', error);
    }
  }

  /**
   * Get default configuration
   */
  getDefaultConfig() {
    return {
      trading: {
        enabled: false,
        testMode: true,
        lowThresholdUSD: 0.00002,
        highThresholdUSD: 0.00008,
        partialSellEnabled: true,
        sellCooldownSeconds: 5,
        migrationPriceBNB: 0.00000008815,
        buyAmountBNB: 0.001,
        maxBuyAmountBNB: 0.01,
        userId: 'main-trader',
        takeProfitPercent: 30, // Sell if price is 30% above buy price
        stopLossPercent: 20    // Sell if price is 20% below buy price
      },
      monitoring: {
        updateIntervalMs: 1000,
        inactiveTimeoutMinutes: 30,
        maxConcurrentTokens: 200,
        priceChangeThreshold: 0.000001,
        lowPriceRemovalUSD: 0.00000001, // Default low price for removal
        lowPriceRemovalMinutes: 10, // Default minutes for low price removal
        batchSize: 3, // Default batch size for price updates
        batchDelayMs: 0, // Default delay between batches
        reentryEnabled: false // Default re-entry enabled
      },
      safety: {
        maxTradesPerHour: 50,
        maxTradesPerDay: 200,
        emergencyStop: false,
        minWalletBalanceBNB: 0.01
      },
      wallets: {
        autoDetect: true,
        maxWallets: 10,
        walletRotation: true
      }
    };
  }

  /**
   * Load available wallets for trading
   */
  async loadAvailableWallets() {
    try {
      if (this.config.wallets.autoDetect) {
        // Load wallets directly from file to get encrypted private keys
        const walletFile = path.join(__dirname, 'data/wallets', `${this.config.trading.userId}.json`);

        if (!fs.existsSync(walletFile)) {
          console.log('❌ No wallet file found');
          this.availableWallets = [];
          return;
        }

        const walletsData = JSON.parse(fs.readFileSync(walletFile, 'utf8'));

        // Get balances for all wallets
        const walletsWithBalances = await Promise.all(
          walletsData.map(async (wallet) => {
            try {
              const balance = await this.getWalletBalance(wallet.address);
              return {
                address: wallet.address,
                balanceBNB: balance,
                encryptedPrivateKey: wallet.encryptedPrivateKey,
                createdAt: wallet.createdAt,
                lastUsed: wallet.lastUsed
              };
            } catch (error) {
              console.error(`Error getting balance for ${wallet.address}:`, error);
              return {
                address: wallet.address,
                balanceBNB: 0,
                encryptedPrivateKey: wallet.encryptedPrivateKey,
                createdAt: wallet.createdAt,
                lastUsed: wallet.lastUsed
              };
            }
          })
        );

        // Sort wallets by balance (highest first) to prioritize funded wallets
        const sortedWallets = walletsWithBalances.sort((a, b) => b.balanceBNB - a.balanceBNB);

        this.availableWallets = sortedWallets;
        console.log(`💰 Loaded ${this.availableWallets.length} wallets for trading`);

        // Show wallet details
        sortedWallets.forEach((wallet, index) => {
          const status = wallet.balanceBNB >= this.config.safety.minWalletBalanceBNB ? '✅' : '⚠️';
          console.log(`   ${index + 1}. ${wallet.address} - ${wallet.balanceBNB} BNB ${status}`);
        });

        const fundedWallets = sortedWallets.filter(w => w.balanceBNB >= this.config.safety.minWalletBalanceBNB);
        if (fundedWallets.length === 0) {
          console.log('⚠️ No funded wallets available');
        } else {
          console.log(`✅ ${fundedWallets.length} wallet(s) ready for trading`);
        }
      }
    } catch (error) {
      console.error('❌ Error loading wallets:', error);
      this.availableWallets = [];
    }
  }

  /**
   * Get wallet balance in BNB
   */
  async getWalletBalance(address) {
    try {
      const balance = await this.withRpcFailover(() => this.publicClient.getBalance({ address }));
      return Number(balance) / 1e18;
    } catch (error) {
      console.error(`Error getting balance for ${address}:`, error);
      return 0;
    }
  }

  /**
   * Get current gas price
   */
  async getCurrentGasPrice() {
    try {
      const gasPrice = await this.withRpcFailover(() => this.publicClient.getGasPrice());
      return gasPrice;
    } catch (error) {
      console.error('Error getting gas price:', error);
      return BigInt(5000000000); // 5 gwei fallback
    }
  }

  /**
   * Send raw transaction
   */
  async sendRawTransaction(signedTransaction) {
    try {
      const txHash = await this.publicClient.sendRawTransaction({ signedTransaction });
      return txHash;
    } catch (error) {
      console.error('Error sending raw transaction:', error);
      throw error;
    }
  }

  /**
   * Get token price using four.meme contract
   */
  async getTokenPrice(tokenAddress) {
    try {
      const TOKEN_MANAGER_HELPER = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
      const TOKEN_MANAGER_HELPER_ABI = [
        {
          "inputs": [
            { "name": "token", "type": "address" }
          ],
          "name": "getTokenInfo",
          "outputs": [
            { "name": "version", "type": "uint256" },
            { "name": "tokenManager", "type": "address" },
            { "name": "quote", "type": "address" },
            { "name": "lastPrice", "type": "uint256" },
            { "name": "tradingFeeRate", "type": "uint256" },
            { "name": "minTradingFee", "type": "uint256" },
            { "name": "launchTime", "type": "uint256" },
            { "name": "offers", "type": "uint256" },
            { "name": "maxOffers", "type": "uint256" },
            { "name": "funds", "type": "uint256" },
            { "name": "maxFunds", "type": "uint256" },
            { "name": "liquidityAdded", "type": "bool" }
          ],
          "stateMutability": "view",
          "type": "function"
        }
      ];

      // Get token info to get lastPrice
      const tokenInfoResult = await this.withRpcFailover(() => this.publicClient.readContract({
        address: TOKEN_MANAGER_HELPER,
        abi: TOKEN_MANAGER_HELPER_ABI,
        functionName: 'getTokenInfo',
        args: [tokenAddress]
      }));

      if (tokenInfoResult && tokenInfoResult.length >= 12) {
        const lastPrice = Number(tokenInfoResult[3]); // lastPrice field
        const quoteToken = tokenInfoResult[2]; // quote token address

        if (lastPrice > 0) {
          // Check if quote token is BNB or USDT
          const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
          const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';

          let priceInUSD;
          let priceInBNB;

          const quoteTokenLc = quoteToken.toLowerCase();
          if (quoteTokenLc === WBNB_ADDRESS.toLowerCase()) {
            // Price is in BNB
            const lastPriceBNB = lastPrice / 1e18;
            priceInBNB = lastPriceBNB;
            const bnbPriceUSD = await this.getBNBPriceUSD();
            priceInUSD = priceInBNB * bnbPriceUSD;
          } else if (this.BSC_STABLES.has(quoteTokenLc)) {
            // Stablecoin quote (assume $1)
            const lastPriceUSD = lastPrice / 1e18; // 18 decimals from helper
            priceInUSD = lastPriceUSD;
            const bnbPriceUSD = await this.getBNBPriceUSD();
            priceInBNB = priceInUSD / bnbPriceUSD;
          } else {
            // Fallback: assume BNB if quote token is zero address or unknown
            if (!this.warnedUnknownQuote.has(tokenAddress.toLowerCase())) {
              console.log(`⚠️ Token ${tokenAddress.slice(0, 8)}... has unknown quote token: ${quoteToken}, assuming BNB`);
              this.warnedUnknownQuote.add(tokenAddress.toLowerCase());
            }
            const lastPriceBNB = lastPrice / 1e18;
            priceInBNB = lastPriceBNB;
            if (priceInBNB < 0.000001) {
              const bnbPriceUSD = await this.getBNBPriceUSD();
              priceInUSD = priceInBNB * bnbPriceUSD;
            }
            else priceInUSD = priceInBNB;
          }

          // Validate price is reasonable (wider range to include matured tokens)
          if (priceInUSD >= 0.00000001 && priceInUSD <= 1) {
            return {
              success: true,
              priceBNB: priceInBNB,
              priceUSD: priceInUSD
            };
          } else {
            console.log(`⚠️ Invalid price detected for ${tokenAddress.slice(0, 8)}...: $${priceInUSD.toFixed(8)}`);
            return { success: false, error: 'Price appears to be invalid or token too new' };
          }
        }
      }

      return { success: false, error: 'Token may be too new or not have liquidity yet' };

    } catch (error) {
      console.error(`Error getting token price for ${tokenAddress}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start the price-based trading system
   */
  async startTrading() {
    if (this.isScanning) {
      console.log('⚠️ Price-based trading is already running');
      return;
    }

    if (!this.config.trading.enabled) {
      console.log('⚠️ Trading is disabled in configuration');
      return;
    }

    // Load available wallets
    await this.loadAvailableWallets();

    if (this.availableWallets.length === 0) {
      console.log('❌ No wallets available for trading');
      console.log('   Please add wallet addresses to the loadAvailableWallets() method');
      return;
    }

    // Update BNB price
    this.bnbPriceUSD = await this.getBNBPriceUSD();
    console.log(`💰 Current BNB price: $${this.bnbPriceUSD.toFixed(2)}`);

    try {
      console.log('🚀 Starting Price-Based Trading System...');
      console.log(`📊 Configuration:`);
      console.log(`   Low Threshold: $${this.config.trading.lowThresholdUSD}`);
      console.log(`   High Threshold: $${this.config.trading.highThresholdUSD}`);
      const migrationPriceUSD = this.config.trading.migrationPriceBNB * this.bnbPriceUSD;
      console.log(`   Migration Price: $${migrationPriceUSD.toFixed(8)}`);
      console.log(`   Buy Amount: ${this.config.trading.buyAmountBNB} BNB`);
      console.log(`   Test Mode: ${this.config.trading.testMode ? 'ON' : 'OFF'}`);
      console.log(`   Wallets: ${this.availableWallets.length}`);
      console.log('');

      // Start token creation scanning
      await this.startTokenScanning();

      // Start price monitoring
      this.startPriceMonitoring();

      this.isScanning = true;
      console.log('✅ Price-based trading system started');

    } catch (error) {
      console.error('❌ Error starting price-based trading:', error);
      throw error;
    }
  }

  /**
   * Stop the price-based trading system
   */
  async stopTrading() {
    if (!this.isScanning) {
      console.log('⚠️ Price-based trading is not running');
      return;
    }

    try {
      console.log('🛑 Stopping price-based trading system...');

      if (this.scanningInterval) {
        clearInterval(this.scanningInterval);
        this.scanningInterval = null;
      }

      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      this.isScanning = false;
      this.isMonitoring = false;
      console.log('✅ Price-based trading system stopped');

    } catch (error) {
      console.error('❌ Error stopping price-based trading:', error);
      throw error;
    }
  }

  /**
   * Start scanning for new token creations
   */
  async startTokenScanning() {
    try {
      // Get the latest block number to start from
      const latestBlock = await this.publicClient.getBlockNumber();
      this.lastProcessedBlock = Number(latestBlock) - 10;
      console.log(`📍 Starting token scanning from block: ${this.lastProcessedBlock}`);

      // Start scanning loop
      this.scanningInterval = setInterval(async () => {
        await this.scanForNewTokens();
      }, this.SCAN_INTERVAL);

    } catch (error) {
      console.error('❌ Error starting token scanning:', error);
      throw error;
    }
  }

  /**
   * Scan for new token creations
   */
  async scanForNewTokens() {
    try {
      const latestBlock = await this.publicClient.getBlockNumber();
      const currentBlock = Number(latestBlock);

      if (currentBlock <= this.lastProcessedBlock) {
        return;
      }

      const fromBlock = this.lastProcessedBlock + 1;
      const toBlock = Math.min(currentBlock, this.lastProcessedBlock + this.MAX_BLOCKS_PER_SCAN);

      // Scan blocks for token creation transactions
      const tokenCreations = await this.scanBlocksForTokenCreations(fromBlock, toBlock);

      // Process each token creation
      for (const tokenCreation of tokenCreations) {
        await this.processNewToken(tokenCreation);
      }

      this.lastProcessedBlock = toBlock;

    } catch (error) {
      console.error('❌ Error scanning for new tokens:', error);
    }
  }

  /**
   * Scan blocks for token creation transactions
   */
  async scanBlocksForTokenCreations(fromBlock, toBlock) {
    const tokenCreations = [];

    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
      try {
        const blockTokenCreations = await this.scanBlockForTokenCreations(blockNum);
        tokenCreations.push(...blockTokenCreations);
      } catch (error) {
        console.log(`⚠️ Error scanning block ${blockNum}: ${error}`);
      }
    }

    return tokenCreations;
  }

  /**
   * Scan a single block for token creation transactions
   */
  async scanBlockForTokenCreations(blockNumber) {
    const tokenCreations = [];

    try {
      const block = await this.publicClient.getBlock({
        blockNumber: BigInt(blockNumber),
        includeTransactions: true
      });

      for (const tx of block.transactions) {
        try {
          // Check if this transaction is TO the four.meme contract
          if (tx.to && tx.to.toLowerCase() === this.FOUR_MEME_CONTRACT.toLowerCase()) {
            const tokenCreation = await this.analyzeFourMemeTransaction(tx, blockNumber);
            if (tokenCreation) {
              tokenCreations.push(tokenCreation);
            }
          }
        } catch (error) {
          console.log(`⚠️ Error analyzing transaction ${tx.hash}: ${error}`);
        }
      }

    } catch (error) {
      console.log(`⚠️ Error getting block ${blockNumber}: ${error}`);
    }

    return tokenCreations;
  }

  /**
   * Analyze a four.meme transaction for token creation
   */
  async analyzeFourMemeTransaction(tx, blockNumber) {
    try {
      // Check if this is a createToken function call
      const isCreateTokenCall = await this.isCreateTokenFunction(tx);
      if (!isCreateTokenCall) {
        return null;
      }

      // Get the created token address from transaction logs
      const tokenAddress = await this.extractTokenAddressFromLogs(tx);
      if (!tokenAddress) {
        return null;
      }

      // Extract gas price (in Gwei) and gas limit
      let gasPriceGwei = undefined;
      let gasLimit = undefined;
      if (tx.gasPrice) {
        gasPriceGwei = Number(tx.gasPrice) / 1e9;
      }
      if (tx.gasLimit) {
        gasLimit = Number(tx.gasLimit);
      } else if (tx.gas) {
        gasLimit = Number(tx.gas);
      }

      return {
        tokenAddress: tokenAddress,
        creatorAddress: tx.from,
        blockNumber,
        transactionHash: tx.hash,
        timestamp: new Date(),
        gasPriceGwei,
        gasLimit
      };

    } catch (error) {
      console.log(`⚠️ Error analyzing four.meme transaction: ${error}`);
      return null;
    }
  }

  /**
   * Process a new token creation
   */
  async processNewToken(tokenCreation) {
    try {
      const tokenAddress = tokenCreation.tokenAddress.toLowerCase();
      // Debug: print gas price and gas limit for every new token
      console.log(`🆕 Token detected: ${tokenAddress}`);
      console.log(`   Gas Price (Gwei): ${tokenCreation.gasPriceGwei}`);
      console.log(`   Gas Limit: ${tokenCreation.gasLimit}`);
      // Pattern filtering: check gas price and gas limit using patternDetection.js
      const matchedPattern = matchPattern(tokenCreation, this.patterns);
      if (!matchedPattern) {
        console.log(`⏩ Token ${tokenAddress.slice(0, 8)}... does NOT match any enabled pattern. Skipping.`);
        return;
      } else {
        console.log(`✅ Token ${tokenAddress.slice(0, 8)}... matches pattern: ${matchedPattern.name}`);
      }

      // Check if we're already monitoring this token
      if (this.monitoredTokens.has(tokenAddress)) {
        return;
      }

      // Check if we've already traded this token (prevent re-trading)
      if (this.tradedTokens.has(tokenAddress)) {
        console.log(`🚫 Skipping already traded token: ${tokenAddress.slice(0, 8)}...`);
        return;
      }

      // Check if we've reached the maximum concurrent tokens limit
      if (this.monitoredTokens.size >= this.config.monitoring.maxConcurrentTokens) {
        console.log(`⚠️ Maximum concurrent tokens reached (${this.config.monitoring.maxConcurrentTokens}), skipping ${tokenAddress.slice(0, 8)}...`);
        return;
      }

      // Get initial price
      const priceResult = await this.getTokenPrice(tokenAddress);
      if (!priceResult.success) {
        console.log(`⚠️ Could not get initial price for ${tokenAddress.slice(0, 8)}..., skipping`);
        return;
      }

      const initialPriceUSD = priceResult.priceUSD;

      // Create monitored token entry
      const monitoredToken = {
        tokenAddress,
        creatorAddress: tokenCreation.creatorAddress,
        creationTime: tokenCreation.timestamp,
        lastPriceUpdate: new Date(),
        lastPriceChange: new Date(),
        currentPriceUSD: initialPriceUSD,
        previousPriceUSD: initialPriceUSD,
        priceChangePercent: 0,
        isActive: true,
        positionOpen: false, // Track if a position is open
        lastSellPriceUSD: 0,  // Track last sell price
        peakPriceSinceLastSell: 0, // Track peak price since last sell for stop loss
        tradeCount: 0,
        tradeCycle: 0,
        hasCompletedFirstCycle: false,
        lastSellTime: null,
        lastSellAttemptAt: null,
        lowPriceSince: null
      };

      this.monitoredTokens.set(tokenAddress, monitoredToken);
      this.tradeStats.tokensMonitored++;

      console.log(`🎯 New token added to monitoring: ${tokenAddress.slice(0, 8)}...`);
      console.log(`   Creator: ${tokenCreation.creatorAddress.slice(0, 8)}...${tokenCreation.creatorAddress.slice(-6)}`);
      console.log(`   Initial Price: $${initialPriceUSD.toFixed(8)}`);
      console.log(`   Monitoring: ${this.monitoredTokens.size}/${this.config.monitoring.maxConcurrentTokens} tokens`);

      // Start monitoring if not already running
      if (!this.isMonitoring) {
        this.startPriceMonitoring();
      }

    } catch (error) {
      console.error(`❌ Error processing new token: ${error}`);
    }
  }

  /**
   * Start price monitoring for all tokens
   */
  startPriceMonitoring() {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    console.log('📈 Starting price monitoring...');
    console.log(`⏱️ Update interval: ${this.config.monitoring.updateIntervalMs}ms`);

    this.monitoringInterval = setInterval(async () => {
      try {
        // Update BNB price every 5 minutes
        if (!this.lastBNBPriceUpdate || Date.now() - this.lastBNBPriceUpdate > 300000) {
          this.bnbPriceUSD = await this.getBNBPriceUSD();
          this.lastBNBPriceUpdate = Date.now();
        }

        await this.updateAllTokenPrices();
      } catch (error) {
        console.error('Error in price monitoring:', error);
      }
    }, this.config.monitoring.updateIntervalMs);
  }

  /**
   * Update prices for all monitored tokens
   */
  async updateAllTokenPrices() {
    const activeTokens = Array.from(this.monitoredTokens.values()).filter(token => token.isActive);

    if (activeTokens.length === 0) {
      return;
    }

    // Process tokens in batches to avoid rate limits
    const batchSize = Math.max(1, Number(this.config.monitoring.batchSize) || 3);
    const batchDelayMs = Math.max(0, Number(this.config.monitoring.batchDelayMs) || 0);
    for (let i = 0; i < activeTokens.length; i += batchSize) {
      const batch = activeTokens.slice(i, i + batchSize);

      const promises = batch.map(token => this.updateTokenPrice(token));
      await Promise.allSettled(promises);

      // Delay between batches to respect rate limits
      if (i + batchSize < activeTokens.length && batchDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, batchDelayMs));
      }
    }
  }

  /**
   * Update price for a specific token
   */
  async updateTokenPrice(token) {
    try {
      // Get current price
      const priceResult = await this.getTokenPrice(token.tokenAddress);

      if (!priceResult.success) {
        console.log(`⚠️ Could not get price for ${token.tokenAddress.slice(0, 8)}...`);
        return;
      }

      const currentPriceUSD = priceResult.priceUSD;
      const previousPriceUSD = token.currentPriceUSD;

      // Calculate price change
      let priceChangePercent = 0;
      if (previousPriceUSD > 0) {
        priceChangePercent = ((currentPriceUSD - previousPriceUSD) / previousPriceUSD) * 100;
      }

      // Update token data
      token.previousPriceUSD = previousPriceUSD;
      token.currentPriceUSD = currentPriceUSD;
      token.priceChangePercent = priceChangePercent;
      // token.lastPriceUpdate = new Date(); // Remove this line so it's not always updated

      // Update last price change time and lastPriceUpdate if price changed significantly
      if (Math.abs(priceChangePercent) > this.config.monitoring.priceChangeThreshold) {
        token.lastPriceChange = new Date();
        token.lastPriceUpdate = new Date();
      }

      // Check for trading opportunities
      await this.checkTradingOpportunities(token);

    } catch (error) {
      console.error(`Error updating price for token ${token.tokenAddress}:`, error.message);
    } finally {
      // Always evaluate inactivity, even if price fetch failed
      await this.checkTokenRemoval(token);
    }
  }

  /**
   * Check for trading opportunities
   */
  async checkTradingOpportunities(token) {
    try {
      const currentPriceUSD = token.currentPriceUSD;
      const now = new Date();
      const maxTradesPerToken = Number(this.config.trading.maxTradesPerCycle ?? 2);
      const currentTradeCount = Number(token.tradeCount || 0);
      const isReentryCycle = !!token.hasCompletedFirstCycle;
      const lowBuy = isReentryCycle ? (this.config.trading.reentryLowThresholdUSD ?? this.config.trading.lowThresholdUSD)
        : this.config.trading.lowThresholdUSD;
      // Use sell thresholds from config or pattern (if available)
      const firstSellPercent = 20.0;
      const secondSellPercent = 50.0;
      const stopLossFromPeakPercent = 15.0;
      const priceStagnationTimeoutSeconds = 30;

      // Only buy if position is not open, under trade cap, and reentry is enabled (or first buy)
      const underTradeCap = currentTradeCount < maxTradesPerToken;
      const isFirstBuy = currentTradeCount === 0;
      const reentryAllowed = this.config.trading.reentryEnabled || isFirstBuy;
      const canBuy = !token.positionOpen && underTradeCap && reentryAllowed && currentPriceUSD >= lowBuy && currentPriceUSD > token.lastSellPriceUSD;
      if (canBuy) {
        if (this.activeBuyLocks.has(token.tokenAddress)) return;
        token.positionOpen = true;
        token.buyPriceUSD = currentPriceUSD;
        token.peakPriceSinceLastSell = currentPriceUSD;
        token.lastPriceChange = new Date();
        await this.withBuyLock(token.tokenAddress, async () => {
          await this.executeBuy(token);
        });
        return;
      }

      // Sell logic
      if (token.positionOpen && !token.sellTransactionHash) {
        // Update peak price if current price is higher
        if (currentPriceUSD > (token.peakPriceSinceLastSell || 0)) {
          token.peakPriceSinceLastSell = currentPriceUSD;
        }
        // Calculate thresholds
        const firstSellPrice = token.buyPriceUSD * (1 + firstSellPercent / 100);
        const secondSellPrice = token.buyPriceUSD * (1 + secondSellPercent / 100);
        const stopLossPrice = token.peakPriceSinceLastSell * (1 - stopLossFromPeakPercent / 100);
        // Sell half at first threshold
        if (!token.hasSoldHalf && currentPriceUSD >= firstSellPrice) {
          token.hasSoldHalf = true;
          await this.withSellLock(token.tokenAddress, async () => {
            await this.executeSell(token, { amountMode: 'half' });
          });
          return;
        }
        // Sell all at second threshold
        if (currentPriceUSD >= secondSellPrice) {
          await this.withSellLock(token.tokenAddress, async () => {
            await this.executeSell(token, { amountMode: 'all' });
          });
          return;
        }
        // Stop loss from peak
        if (currentPriceUSD <= stopLossPrice) {
          await this.withSellLock(token.tokenAddress, async () => {
            await this.executeSell(token, { amountMode: 'all' });
          });
          return;
        }
        // Price stagnation: sell all if price hasn't changed for more than 30 seconds
        if (token.lastPriceChange && (now.getTime() - token.lastPriceChange.getTime()) / 1000 > priceStagnationTimeoutSeconds) {
          await this.withSellLock(token.tokenAddress, async () => {
            await this.executeSell(token, { amountMode: 'all' });
          });
          return;
        }
      }
    } catch (error) {
      console.error(`Error checking trading opportunities for token ${token.tokenAddress}:`, error.message);
    }
  }

  /**
   * Execute buy order
   */
  async executeBuy(token) {
    try {
      // Guard: respect per-token trade cap before placing any buy
      const maxTradesPerToken = Number(this.config.trading.maxTradesPerCycle ?? 2);
      const currentTradeCount = Number(token.tradeCount || 0);
      if (currentTradeCount >= maxTradesPerToken) {
        return;
      }

      if (this.config.trading.testMode) {
        console.log(`🧪 TEST MODE: Would buy ${token.tokenAddress.slice(0, 8)}... for ${this.config.trading.buyAmountBNB} BNB`);
        token.hasBeenTraded = true;
        token.buyPriceUSD = token.currentPriceUSD;
        token.buyTransactionHash = 'TEST_BUY_' + Date.now();
        // Initialize risk management flags
        token.peakPriceSinceLastSell = token.buyPriceUSD; // Reset peak to buy price
        token.hasSoldHalf = false;
        token.passedMiddle = false;
        token.wasAboveMiddle = token.currentPriceUSD >= (this.config.trading.middleSellThresholdUSD ?? this.config.trading.highThresholdUSD);
        token.lastCrossAboveMiddleAt = token.wasAboveMiddle ? new Date() : null;
        token.lastCrossBelowMiddleAt = !token.wasAboveMiddle ? new Date() : null;
        token.buyTime = new Date();
        this.tradeStats.successfulBuys++;
        // positionOpen already set above
        return;
      }

      console.log(`🔄 Executing REAL buy order for ${token.tokenAddress.slice(0, 8)}...`);
      console.log(`   Amount: ${this.config.trading.buyAmountBNB} BNB`);
      console.log(`   Price: $${token.currentPriceUSD.toFixed(8)}`);

      // Execute real buy transaction
      const buyResult = await this.executeRealBuy(token);

      if (buyResult.success) {
        token.hasBeenTraded = true;
        token.buyPriceUSD = token.currentPriceUSD;
        token.buyTransactionHash = buyResult.transactionHash;
        // Initialize risk management flags
        token.peakPriceSinceLastSell = token.buyPriceUSD; // Reset peak to buy price
        token.hasSoldHalf = false;
        token.passedMiddle = false;
        token.wasAboveMiddle = token.currentPriceUSD >= (this.config.trading.middleSellThresholdUSD ?? this.config.trading.highThresholdUSD);
        token.lastCrossAboveMiddleAt = token.wasAboveMiddle ? new Date() : null;
        token.lastCrossBelowMiddleAt = !token.wasAboveMiddle ? new Date() : null;
        token.buyTime = new Date();
        this.tradeStats.successfulBuys++;
        this.tradeStats.totalTrades++;
        // positionOpen already set above

        console.log(`✅ REAL buy completed for ${token.tokenAddress.slice(0, 8)}...`);
        console.log(`   Transaction: ${buyResult.transactionHash}`);
      } else {
        console.log(`❌ Buy failed for ${token.tokenAddress.slice(0, 8)}...: ${buyResult.error}`);
        // Reset position if buy failed
        token.positionOpen = false;
      }

    } catch (error) {
      console.error(`Error executing buy order:`, error.message);
      // Reset position if buy failed due to error
      token.positionOpen = false;
    }
  }

  /**
   * Execute sell order
   */
  async executeSell(token, options = { amountMode: 'all' }) {
    try {
      const amountMode = options.amountMode || 'all';
      // Cooldown after any sell attempt to avoid rapid re-triggers
      const cooldownMs = Math.max(0, Number(this.config.trading.sellCooldownSeconds || 0) * 1000);
      const now = new Date();
      if (cooldownMs > 0 && token.lastSellAttemptAt && (now.getTime() - token.lastSellAttemptAt.getTime()) < cooldownMs) {
        return;
      }
      token.lastSellAttemptAt = now;
      if (this.config.trading.testMode) {
        const note = amountMode === 'half' ? 'half (TEST)' : 'all (TEST)';
        console.log(`🧪 TEST MODE: Would sell ${note} for ${token.tokenAddress.slice(0, 8)}...`);
        token.sellPriceUSD = token.currentPriceUSD;
        if (amountMode === 'all') {
          token.sellTransactionHash = 'TEST_SELL_' + Date.now();
          this.tradeStats.successfulSells++;
          token.positionOpen = false;
          token.lastSellPriceUSD = token.currentPriceUSD;
          // Re-entry handling in test mode
          const maxTradesPerToken = Number(this.config.trading.maxTradesPerCycle ?? 2);
          const currentTradeCount = Number(token.tradeCount || 0);
          if (this.config.trading.reentryEnabled && currentTradeCount + 1 < maxTradesPerToken) {
            token.lastSellTime = new Date();
            token.tradeCount = currentTradeCount + 1;
            token.tradeCycle = (token.tradeCycle || 0) + 1;
            token.hasCompletedFirstCycle = true;
            // Reset state for re-entry while keeping token monitored
            token.hasBeenTraded = false;
            token.buyPriceUSD = 0;
            token.peakPriceSinceLastSell = 0; // Reset peak price for re-entry
            token.hasSoldHalf = false;
            token.passedMiddle = false;
            token.wasAboveMiddle = false;
            token.sellTransactionHash = undefined;
          } else {
            // Mark token as traded and remove from monitoring
            this.tradedTokens.add(token.tokenAddress);
            await this.removeTokenFromMonitoring(token);
          }
        } else {
          // Partial sell bookkeeping only
          token.partialSellAtUSD = token.currentPriceUSD;
          token.hasSoldHalf = true;
        }
        return;
      }

      console.log(`🔄 Executing REAL sell order (${amountMode}) for ${token.tokenAddress.slice(0, 8)}...`);
      console.log(`   Price: $${token.currentPriceUSD.toFixed(8)}`);

      // Execute real sell transaction
      const sellResult = await this.executeRealSell(token, { amountMode });

      if (sellResult.success) {
        token.sellPriceUSD = token.currentPriceUSD;
        if (amountMode === 'all') {
          token.sellTransactionHash = sellResult.transactionHash;
          this.tradeStats.successfulSells++;
          this.tradeStats.totalTrades++;
          token.positionOpen = false;
          token.lastSellPriceUSD = token.currentPriceUSD;

          // Calculate profit/loss
          if (token.buyPriceUSD) {
            const profitLossUSD = token.sellPriceUSD - token.buyPriceUSD;
            this.tradeStats.totalProfitUSD += profitLossUSD;
            console.log(`💰 Trade completed:`);
            console.log(`   Buy Price: $${token.buyPriceUSD.toFixed(8)}`);
            console.log(`   Sell Price: $${token.sellPriceUSD.toFixed(8)}`);
            console.log(`   P&L: $${profitLossUSD.toFixed(8)}`);
          }

          // Re-entry handling
          const maxTradesPerToken = Number(this.config.trading.maxTradesPerCycle ?? 2);
          const currentTradeCount = Number(token.tradeCount || 0);
          if (this.config.trading.reentryEnabled && currentTradeCount + 1 < maxTradesPerToken) {
            token.lastSellTime = new Date();
            token.tradeCount = currentTradeCount + 1;
            token.tradeCycle = (token.tradeCycle || 0) + 1;
            token.hasCompletedFirstCycle = true;
            // Reset state for re-entry while keeping token monitored
            token.hasBeenTraded = false;
            token.buyPriceUSD = 0;
            token.peakPriceSinceLastSell = 0; // Reset peak price for re-entry
            token.hasSoldHalf = false;
            token.passedMiddle = false;
            token.wasAboveMiddle = false;
            token.sellTransactionHash = undefined;
          } else {
            // Mark token as traded and remove from monitoring
            this.tradedTokens.add(token.tokenAddress);
            await this.removeTokenFromMonitoring(token);
          }

          console.log(`✅ REAL sell completed for ${token.tokenAddress.slice(0, 8)}...`);
          console.log(`   Transaction: ${sellResult.transactionHash}`);
        } else {
          // Partial sell bookkeeping
          token.partialSellAtUSD = token.currentPriceUSD;
          token.hasSoldHalf = true;
          console.log(`✅ REAL partial sell (half) completed for ${token.tokenAddress.slice(0, 8)}...`);
        }
      } else {
        console.log(`❌ Sell failed for ${token.tokenAddress.slice(0, 8)}...: ${sellResult.error}`);
      }

    } catch (error) {
      console.error(`Error executing sell order:`, error.message);
    }
  }

  /**
   * Ensure only one sell runs per token at a time
   */
  async withSellLock(tokenAddress, fn) {
    const key = tokenAddress.toLowerCase();
    if (this.activeSellLocks.has(key)) return;
    this.activeSellLocks.add(key);
    try {
      await fn();
    } finally {
      this.activeSellLocks.delete(key);
    }
  }

  async withBuyLock(tokenAddress, fn) {
    const key = tokenAddress.toLowerCase();
    if (this.activeBuyLocks.has(key)) return;
    this.activeBuyLocks.add(key);
    try {
      await fn();
    } finally {
      this.activeBuyLocks.delete(key);
    }
  }

  /**
   * Execute real buy transaction using proper four.meme implementation
   */
  async executeRealBuy(token) {
    try {
      // Get funded wallets
      const fundedWallets = this.availableWallets.filter(wallet =>
        wallet.balanceBNB >= this.config.trading.buyAmountBNB + 0.001 // Add gas buffer
      );

      if (fundedWallets.length === 0) {
        return { success: false, error: 'No funded wallets available' };
      }

      console.log(`💰 Using ${fundedWallets.length} funded wallets for buy`);

      // Check if token is migrated to PancakeSwap
      const isMigrated = await this.isTokenMigrated(token.tokenAddress);
      if (isMigrated) {
        console.log(`🔄 Token ${token.tokenAddress.slice(0, 8)}... is migrated to PancakeSwap`);
        return { success: false, error: 'Token migrated to PancakeSwap - not supported yet' };
      }

      // Get token info and buy parameters
      const tokenInfo = await this.getTokenInfo(token.tokenAddress);
      if (!tokenInfo.success) {
        return { success: false, error: 'Failed to get token info' };
      }

      const buyParams = await this.getBuyParams(token.tokenAddress, this.config.trading.buyAmountBNB);
      if (!buyParams.success) {
        return { success: false, error: 'Failed to get buy parameters' };
      }

      // Send transactions directly per wallet
      const txHashes = [];
      let successCount = 0;

      for (const wallet of fundedWallets) {
        try {
          const walletClient = this.createWalletClient(wallet.address);
          const nonce = await this.publicClient.getTransactionCount({
            address: wallet.address
          });
          const gasPrice = await this.getCurrentGasPrice();

          // Encode transaction data based on token version
          let transactionData;
          if (tokenInfo.data.version === 1) {
            transactionData = this.encodeFunctionData({
              abi: this.TOKEN_MANAGER_V1_ABI,
              functionName: 'purchaseTokenAMAP',
              args: [
                token.tokenAddress,
                buyParams.data.amountFunds,
                0n // minAmount (0 for maximum tokens)
              ]
            });
          } else {
            transactionData = this.encodeFunctionData({
              abi: this.TOKEN_MANAGER_V2_ABI,
              functionName: 'buyTokenAMAP',
              args: [
                token.tokenAddress,
                buyParams.data.amountFunds,
                0n // minAmount (0 for maximum tokens)
              ]
            });
          }

          // Send transaction directly
          const txHash = await walletClient.sendTransaction({
            account: walletClient.account,
            to: buyParams.data.tokenManager,
            value: buyParams.data.amountMsgValue,
            gas: 500000n,
            gasPrice,
            nonce,
            data: transactionData
          });

          txHashes.push(txHash);
          successCount++;

          // Update wallet last used
          this.updateWalletLastUsed(wallet.address);

        } catch (error) {
          console.error(`Error preparing buy transaction for wallet ${wallet.address}:`, error);
        }
      }

      if (successCount === 0) {
        return { success: false, error: 'Failed to prepare any buy transactions' };
      }

      return {
        success: true,
        transactionHash: txHashes[0]
      };

    } catch (error) {
      console.error(`Error in real buy execution:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute real sell transaction
   */
  async executeRealSell(token, { amountMode = 'all' } = {}) {
    try {
      // Get wallets that have this token
      const walletsWithToken = [];

      for (const wallet of this.availableWallets) {
        try {
          const balance = await this.getTokenBalance(token.tokenAddress, wallet.address);
          if (balance > 0n) {
            walletsWithToken.push({ ...wallet, tokenBalance: balance });
          }
        } catch (error) {
          console.error(`Error checking token balance for ${wallet.address}:`, error);
        }
      }

      if (walletsWithToken.length === 0) {
        return { success: false, error: 'No wallets have tokens to sell' };
      }

      console.log(`💰 Found ${walletsWithToken.length} wallets with tokens to sell`);

      // Check if token is migrated to PancakeSwap
      const isMigrated = await this.isTokenMigrated(token.tokenAddress);
      if (isMigrated) {
        console.log(`🔄 Token ${token.tokenAddress.slice(0, 8)}... is migrated to PancakeSwap`);
        return { success: false, error: 'Token migrated to PancakeSwap - not supported yet' };
      }

      // Get token info
      const tokenInfo = await this.getTokenInfo(token.tokenAddress);
      if (!tokenInfo.success) {
        return { success: false, error: 'Failed to get token info' };
      }

      // Send transactions directly per wallet
      const txHashes = [];
      let successCount = 0;

      const sendWithNonceRetry = async (walletClient, tx, address) => {
        try {
          return await walletClient.sendTransaction(tx);
        } catch (err) {
          const msg = String(err?.message || err);
          if (msg.includes('nonce too low') || msg.includes('Nonce provided') || msg.includes('already used')) {
            const refreshed = await this.publicClient.getTransactionCount({ address });
            return await walletClient.sendTransaction({ ...tx, nonce: refreshed });
          }
          throw err;
        }
      };

      for (const wallet of walletsWithToken) {
        try {
          const walletClient = this.createWalletClient(wallet.address);
          let nonce = await this.publicClient.getTransactionCount({
            address: wallet.address
          });
          const gasPrice = await this.getCurrentGasPrice();

          // Determine amount to sell
          let amountToSell = wallet.tokenBalance;
          if (amountMode === 'half') {
            amountToSell = wallet.tokenBalance / 2n; // integer division; OK to round down
            if (amountToSell === 0n) {
              continue; // skip negligible balances
            }
          }

          // Check allowance
          const allowance = await this.getTokenAllowance(
            token.tokenAddress,
            wallet.address,
            tokenInfo.data.tokenManager
          );

          // Add approval transaction if needed
          if (allowance < amountToSell) {
            const approveData = this.encodeFunctionData({
              abi: this.ERC20_ABI,
              functionName: 'approve',
              args: [tokenInfo.data.tokenManager, this.maxUint256()]
            });

            const approveTxHash = await sendWithNonceRetry(walletClient, {
              account: walletClient.account,
              to: token.tokenAddress,
              value: 0n,
              gas: 100000n,
              gasPrice,
              nonce,
              data: approveData
            }, wallet.address);
            console.log(`✅ Approve submitted for ${wallet.address.slice(0, 8)}...: ${approveTxHash}`);
            nonce++;
          }

          // Encode sell transaction based on token version
          let sellData;
          if (tokenInfo.data.version === 1) {
            sellData = this.encodeFunctionData({
              abi: this.TOKEN_MANAGER_V1_ABI,
              functionName: 'saleToken',
              args: [token.tokenAddress, amountToSell]
            });
          } else {
            sellData = this.encodeFunctionData({
              abi: this.TOKEN_MANAGER_V2_ABI,
              functionName: 'sellToken',
              args: [token.tokenAddress, amountToSell]
            });
          }

          // Send sell transaction directly
          const sellTxHash = await sendWithNonceRetry(walletClient, {
            account: walletClient.account,
            to: tokenInfo.data.tokenManager,
            value: 0n,
            gas: 500000n,
            gasPrice,
            nonce,
            data: sellData
          }, wallet.address);

          txHashes.push(sellTxHash);
          successCount++;

          console.log(`✅ Sell transaction (${amountMode}) submitted for wallet ${wallet.address.slice(0, 8)}...`);

        } catch (error) {
          console.error(`Error preparing sell transaction for wallet ${wallet.address}:`, error);
        }
      }

      if (successCount === 0) {
        return { success: false, error: 'Failed to prepare any sell transactions' };
      }

      return {
        success: true,
        transactionHash: txHashes[0]
      };

    } catch (error) {
      console.error(`Error in real sell execution:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if token should be removed from monitoring
   */
  async checkTokenRemoval(token) {
    try {
      const now = new Date();
      // Base inactivity on last successful price update timestamp
      const inactiveTimeMinutes = (now.getTime() - token.lastPriceUpdate.getTime()) / (1000 * 60);

      // Remove if inactive for too long
      if (inactiveTimeMinutes >= this.config.monitoring.inactiveTimeoutMinutes) {
        console.log(`⏰ Removing inactive token: ${token.tokenAddress.slice(0, 8)}...`);
        console.log(`   Inactive for: ${inactiveTimeMinutes.toFixed(1)} minutes`);
        await this.removeTokenFromMonitoring(token);
        return;
      }

      // Remove if we already fully sold and no reason to track further
      // But only if reentry is disabled or we've reached max trades
      if (token.hasBeenTraded && token.sellTransactionHash) {
        const maxTradesPerToken = Number(this.config.trading.maxTradesPerCycle ?? 1);
        const currentTradeCount = Number(token.tradeCount || 0);
        const shouldRemove = !this.config.trading.reentryEnabled || currentTradeCount >= maxTradesPerToken;
        
        if (shouldRemove) {
          console.log(`🧹 Removing post-trade token: ${token.tokenAddress.slice(0, 8)}... (sold out)`);
          this.tradedTokens.add(token.tokenAddress);
          await this.removeTokenFromMonitoring(token);
          return;
        }
      }

      // Low price timed removal: if price stays below configured threshold for configured minutes
      const lowPrice = this.config.monitoring.lowPriceRemovalUSD;
      const lowMinutes = this.config.monitoring.lowPriceRemovalMinutes;
      if (typeof lowPrice === 'number' && typeof lowMinutes === 'number' && lowMinutes > 0) {
        if (token.currentPriceUSD <= lowPrice) {
          // Track when it first went low
          if (!token.lowPriceSince) {
            token.lowPriceSince = now;
          }
          const lowDurMinutes = (now.getTime() - token.lowPriceSince.getTime()) / (1000 * 60);
          if (lowDurMinutes >= lowMinutes) {
            console.log(`🗑️ Removing low-priced token: ${token.tokenAddress.slice(0, 8)}...`);
            console.log(`   Price $${token.currentPriceUSD.toFixed(8)} ≤ $${lowPrice}, for ${lowDurMinutes.toFixed(1)} minutes`);
            await this.removeTokenFromMonitoring(token);
            return;
          }
        } else {
          // Reset if price recovered above low threshold
          token.lowPriceSince = null;
        }
      }

    } catch (error) {
      console.error(`Error checking token removal:`, error.message);
    }
  }

  /**
   * Remove token from monitoring
   */
  async removeTokenFromMonitoring(token) {
    // Prevent removing the same token multiple times
    if (!this.monitoredTokens.has(token.tokenAddress)) {
      return;
    }
    
    this.monitoredTokens.delete(token.tokenAddress);
    token.isActive = false;

    console.log(`🗑️ Removed token from monitoring: ${token.tokenAddress.slice(0, 8)}...`);
    console.log(`   Final price: $${token.currentPriceUSD.toFixed(8)}`);

    if (token.hasBeenTraded) {
      this.tradeStats.tokensTraded++;
    }
  }

  /**
   * Check if a transaction is calling the createToken function
   */
  async isCreateTokenFunction(tx) {
    try {
      if (!tx.input || tx.input === '0x') {
        return false;
      }

      const createTokenMethodId = '0x519ebb10';
      return tx.input.toLowerCase().startsWith(createTokenMethodId.toLowerCase());
    } catch (error) {
      console.log(`⚠️ Error checking createToken function: ${error}`);
      return false;
    }
  }

  /**
   * Extract the created token address from transaction logs
   */
  async extractTokenAddressFromLogs(tx) {
    try {
      const receipt = await this.publicClient.getTransactionReceipt({
        hash: tx.hash
      });

      if (!receipt || !receipt.logs) {
        return null;
      }

      // Look for logs from four.meme contract
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === this.FOUR_MEME_CONTRACT.toLowerCase()) {
          // Extract token address from log data
          if (log.data && log.data.length >= 130) {
            const secondChunk = log.data.slice(66, 130);
            const tokenAddress = '0x' + secondChunk.slice(24);

            if (tokenAddress !== '0x0000000000000000000000000000000000000000' &&
              tokenAddress.length === 42) {
              return tokenAddress.toLowerCase();
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.log(`⚠️ Error extracting token address from logs: ${error}`);
      return null;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
    console.log('📝 Price trading configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get trading statistics
   */
  getStats() {
    return {
      ...this.tradeStats,
      tokensCurrentlyMonitored: this.monitoredTokens.size,
      isRunning: this.isScanning,
      availableWallets: this.availableWallets.length
    };
  }

  /**
   * Get all monitored tokens
   */
  getMonitoredTokens() {
    return Array.from(this.monitoredTokens.values());
  }

  /**
   * Force stop monitoring a specific token
   */
  async stopMonitoringToken(tokenAddress) {
    try {
      const token = this.monitoredTokens.get(tokenAddress.toLowerCase());
      if (!token) {
        return { success: false, error: 'Token not found in monitoring' };
      }

      await this.removeTokenFromMonitoring(token);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current BNB price in USD from PancakeSwap
   */
  async getBNBPriceUSD() {
    try {
      const PANCAKESWAP_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
      const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
      const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';

      const amountsOut = await this.withRpcFailover(() => this.publicClient.readContract({
        address: PANCAKESWAP_ROUTER_V2,
        abi: this.PANCAKESWAP_V2_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [
          BigInt(1e18), // 1 BNB
          [WBNB_ADDRESS, USDT_ADDRESS] // WBNB -> USDT
        ]
      }));

      if (amountsOut && amountsOut.length >= 2) {
        return Number(amountsOut[1]) / 1e18;
      }
      // Keep previous value if available to avoid bad fallback
      return this.bnbPriceUSD || 1000;
    } catch (error) {
      console.log('⚠️ Could not get BNB price:', error.message);
      return this.bnbPriceUSD || 1000;
    }
  }

  /**
   * Create wallet client for transaction signing
   */
  createWalletClient(address) {
    const wallet = this.availableWallets.find(w => w.address.toLowerCase() === address.toLowerCase());
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    try {
      // Decrypt the private key
      const privateKey = SimpleSecurityUtils.decrypt(wallet.encryptedPrivateKey);
      const account = privateKeyToAccount(privateKey);
      return createWalletClient({ account, chain: bsc, transport: this.transport });
    } catch (error) {
      throw new Error(`Failed to decrypt private key for wallet ${address}: ${error.message}`);
    }
  }

  /**
   * Update wallet last used timestamp
   */
  updateWalletLastUsed(address) {
    // Update the wallet's last used timestamp in the available wallets list
    const wallet = this.availableWallets.find(w => w.address.toLowerCase() === address.toLowerCase());
    if (wallet) {
      wallet.lastUsed = new Date();
    }
  }

  /**
   * Check if token is migrated to PancakeSwap
   */
  async isTokenMigrated(tokenAddress) {
    try {
      const tokenInfo = await this.getTokenInfo(tokenAddress);

      if (!tokenInfo.success) {
        return true; // If we can't get token info, assume migrated
      }

      // Check if token manager is zero address (indicates migration)
      if (tokenInfo.data.tokenManager === '0x0000000000000000000000000000000000000000') {
        return true;
      }

      // Check if token has liquidity but no offers (migrated pattern)
      if (tokenInfo.data.liquidityAdded && tokenInfo.data.offers === 0n) {
        return true;
      }

      return false;

    } catch (error) {
      console.log(`Token ${tokenAddress} migration check failed - assuming migrated:`, error.message);
      return true;
    }
  }

  /**
   * Get token info from four.meme
   */
  async getTokenInfo(tokenAddress) {
    try {
      const result = await this.withRpcFailover(() => this.publicClient.readContract({
        address: this.TOKEN_MANAGER_HELPER,
        abi: this.TOKEN_MANAGER_HELPER_ABI,
        functionName: 'getTokenInfo',
        args: [tokenAddress]
      }));

      return {
        success: true,
        data: {
          version: result[0],
          tokenManager: result[1],
          quote: result[2],
          lastPrice: result[3],
          tradingFeeRate: result[4],
          minTradingFee: result[5],
          launchTime: result[6],
          offers: result[7],
          maxOffers: result[8],
          funds: result[9],
          maxFunds: result[10],
          liquidityAdded: result[11]
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get buy parameters for a token
   */
  async getBuyParams(tokenAddress, bnbAmount) {
    try {
      const bnbAmountWei = BigInt(Math.floor(bnbAmount * 1e18));

      // Use tryBuy to get exact parameters
      const tryBuyResult = await this.withRpcFailover(() => this.publicClient.readContract({
        address: this.TOKEN_MANAGER_HELPER,
        abi: this.TOKEN_MANAGER_HELPER_ABI,
        functionName: 'tryBuy',
        args: [tokenAddress, 0n, bnbAmountWei] // amount=0 for AMAP, funds=bnbAmount
      }));

      return {
        success: true,
        data: {
          tokenManager: tryBuyResult[0], // tokenManager
          quote: tryBuyResult[1], // quote
          estimatedAmount: tryBuyResult[2], // estimatedAmount
          estimatedCost: tryBuyResult[3], // estimatedCost
          estimatedFee: tryBuyResult[4], // estimatedFee
          amountMsgValue: tryBuyResult[5], // amountMsgValue
          amountApproval: tryBuyResult[6], // amountApproval
          amountFunds: tryBuyResult[7] // amountFunds
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get token allowance
   */
  async getTokenAllowance(tokenAddress, ownerAddress, spenderAddress) {
    try {
      const allowance = await this.publicClient.readContract({
        address: tokenAddress,
        abi: this.ERC20_ABI,
        functionName: 'allowance',
        args: [ownerAddress, spenderAddress]
      });
      return allowance;
    } catch (error) {
      console.error(`Error getting allowance:`, error);
      return 0n;
    }
  }

  /**
   * Get ERC20 token balance for a wallet
   */
  async getTokenBalance(tokenAddress, ownerAddress) {
    try {
      const balance = await this.publicClient.readContract({
        address: tokenAddress,
        abi: this.ERC20_ABI,
        functionName: 'balanceOf',
        args: [ownerAddress]
      });
      return balance;
    } catch (error) {
      console.error(`Error getting token balance:`, error);
      return 0n;
    }
  }

  /**
   * Encode function data
   */
  encodeFunctionData({ abi, functionName, args }) {
    return encodeFunctionData({
      abi,
      functionName,
      args
    });
  }

  /**
   * Get max uint256 value
   */
  maxUint256() {
    return maxUint256;
  }

  /**
   * Submit transaction bundle
   */
  async submitBundle(transactions) {
    try {
      console.log(`Submitting bundle with ${transactions.length} transactions`);

      const results = [];
      let successCount = 0;

      for (let i = 0; i < transactions.length; i++) {
        try {
          const signedTx = `0x${transactions[i]}`;

          console.log(`📤 Submitting transaction ${i + 1}: ${signedTx.slice(0, 20)}...`);

          const txHash = await this.sendRawTransaction(signedTx);

          console.log(`✅ Transaction ${i + 1} submitted successfully: ${txHash}`);
          results.push({ success: true, txHash });
          successCount++;

          // Wait between transactions to avoid nonce issues
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          console.error(`❌ Error submitting transaction ${i + 1}:`, error);
          results.push({ success: false, error: error.message });
        }
      }

      if (successCount === 0) {
        return {
          success: false,
          error: 'All transactions failed to submit'
        };
      }

      const firstSuccess = results.find(r => r.success);
      return {
        success: true,
        bundleHash: firstSuccess?.txHash || 'Unknown',
        results
      };

    } catch (error) {
      console.error('Error submitting bundle:', error);
      return {
        success: false,
        error: `Failed to submit bundle: ${error.message}`
      };
    }
  }
}

module.exports = { SimplePriceBasedTradingService };
