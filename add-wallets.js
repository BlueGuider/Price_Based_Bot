#!/usr/bin/env node

/**
 * Wallet Configuration Helper
 * This script helps you add wallet addresses to the price-based trading service
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function addWallets() {
  console.log('🔧 Wallet Configuration Helper');
  console.log('='.repeat(40));
  console.log('');
  console.log('This script will help you add wallet addresses to your price-based trading bot.');
  console.log('Make sure you have the private keys for these wallets securely stored.');
  console.log('');

  const wallets = [];
  let addMore = true;

  while (addMore) {
    const address = await question('Enter wallet address (0x...): ');
    
    if (address && address.startsWith('0x') && address.length === 42) {
      wallets.push(address);
      console.log(`✅ Added wallet: ${address}`);
    } else {
      console.log('❌ Invalid address format. Please enter a valid Ethereum address.');
    }

    const continueAdding = await question('Add another wallet? (y/n): ');
    addMore = continueAdding.toLowerCase() === 'y' || continueAdding.toLowerCase() === 'yes';
  }

  if (wallets.length === 0) {
    console.log('❌ No wallets added. Exiting.');
    rl.close();
    return;
  }

  console.log('');
  console.log(`📊 Summary: ${wallets.length} wallet(s) added`);
  wallets.forEach((wallet, index) => {
    console.log(`   ${index + 1}. ${wallet}`);
  });

  console.log('');
  console.log('📝 To use these wallets, you need to:');
  console.log('1. Open simplePriceBasedTradingService.js');
  console.log('2. Find the loadAvailableWallets() method');
  console.log('3. Replace the empty array with your wallet addresses:');
  console.log('');
  console.log('this.availableWallets = [');
  wallets.forEach(wallet => {
    console.log(`  '${wallet}',`);
  });
  console.log('];');
  console.log('');

  const saveToFile = await question('Save wallet addresses to a file? (y/n): ');
  if (saveToFile.toLowerCase() === 'y' || saveToFile.toLowerCase() === 'yes') {
    const walletData = {
      wallets: wallets,
      timestamp: new Date().toISOString(),
      note: 'Wallet addresses for price-based trading bot'
    };
    
    fs.writeFileSync('wallet-addresses.json', JSON.stringify(walletData, null, 2));
    console.log('✅ Wallet addresses saved to wallet-addresses.json');
  }

  console.log('');
  console.log('⚠️  Important Security Notes:');
  console.log('• Keep your private keys secure and never share them');
  console.log('• Only add wallets you control');
  console.log('• Test with small amounts first');
  console.log('• Monitor your wallets regularly');
  console.log('');

  rl.close();
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Goodbye!');
  rl.close();
  process.exit(0);
});

// Start the wallet configuration
addWallets().catch(error => {
  console.error('❌ Error:', error);
  rl.close();
  process.exit(1);
});


