require('dotenv').config();

const path = require('path');

async function main() {
  try {
    const args = process.argv.slice(2);
    const help = args.includes('--help') || args.includes('-h');
    if (help) {
      console.log('Usage: node sellToken.js <TOKEN_ADDRESS> [--real]');
      console.log('  <TOKEN_ADDRESS>  EVM token address to sell');
      console.log('  --real           Execute real sell (default is test mode)');
      process.exit(0);
    }

    const tokenArg = args.find(a => /^0x[0-9a-fA-F]{40}$/.test(a)) || process.env.TOKEN_ADDRESS;
    if (!tokenArg) {
      console.error('❌ Please provide a token address: node sellToken.js <TOKEN_ADDRESS> [--real]');
      process.exit(1);
    }

    const isReal = args.includes('--real');

    const { SimplePriceBasedTradingService } = require(path.join(__dirname, 'simplePriceBasedTradingService'));
    const service = new SimplePriceBasedTradingService();

    // Ensure wallets are loaded before proceeding
    await service.loadAvailableWallets();

    // Update config for this run
    service.updateConfig({
      trading: {
        ...service.getConfig().trading,
        enabled: true,
        testMode: !isReal
      }
    });

    const tokenAddress = tokenArg.toLowerCase();
    console.log(`\n🟨 Preparing ${isReal ? 'REAL' : 'TEST'} sell for token ${tokenAddress.slice(0, 8)}...`);

    // Try to fetch current price for logging
    let currentPriceUSD = 0;
    try {
      const price = await service.getTokenPrice(tokenAddress);
      if (price && price.success) {
        currentPriceUSD = price.priceUSD;
      } else {
        console.log('⚠️ Could not fetch token price, proceeding without price.');
      }
    } catch (e) {
      console.log('⚠️ Price fetch error, proceeding:', e.message);
    }

    // Minimal token shape expected by executeSell/executeRealSell
    const token = {
      tokenAddress,
      currentPriceUSD: currentPriceUSD || 0,
      hasBeenTraded: true,
      sellTransactionHash: null
    };

    await service.executeSell(token);

    console.log(`\n✅ Sell flow finished (${isReal ? 'REAL' : 'TEST'}).`);
    process.exit(0);
  } catch (err) {
    console.error('Unhandled error during sell:', err);
    process.exit(1);
  }
}

main();



