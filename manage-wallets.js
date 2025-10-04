#!/usr/bin/env node

/**
 * Wallet Management Script for Price-Based Trading Bot
 * This script helps you manage wallets using the integrated wallet service
 */

const { WalletService } = require('./walletService');
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

async function main() {
  console.log('🔧 Wallet Management for Price-Based Trading Bot');
  console.log('='.repeat(50));
  console.log('');

  const userId = 'main-trader'; // Default user ID for the trading bot

  while (true) {
    console.log('📋 Available Commands:');
    console.log('1. Create wallets');
    console.log('2. List wallets');
    console.log('3. Check wallet balances');
    console.log('4. Get wallet statistics');
    console.log('5. Delete a wallet');
    console.log('6. Exit');
    console.log('');

    const choice = await question('Choose an option (1-6): ');

    switch (choice) {
      case '1':
        await createWallets(userId);
        break;
      case '2':
        await listWallets(userId);
        break;
      case '3':
        await checkBalances(userId);
        break;
      case '4':
        await getStats(userId);
        break;
      case '5':
        await deleteWallet(userId);
        break;
      case '6':
        console.log('👋 Goodbye!');
        rl.close();
        process.exit(0);
      default:
        console.log('❌ Invalid choice. Please try again.');
    }
    console.log('');
  }
}

async function createWallets(userId) {
  try {
    const countStr = await question('How many wallets to create? (1-20): ');
    const count = parseInt(countStr);

    if (isNaN(count) || count < 1 || count > 20) {
      console.log('❌ Invalid count. Please enter a number between 1 and 20.');
      return;
    }

    console.log(`🔄 Creating ${count} wallet(s)...`);
    const result = await WalletService.createWallets(userId, count);

    if (result.success) {
      console.log(`✅ Successfully created ${result.data.count} wallet(s)`);
      console.log('');
      console.log('📋 New Wallets:');
      result.data.wallets.forEach((wallet, index) => {
        console.log(`   ${index + 1}. ${wallet.address}`);
      });
      console.log('');
      console.log('⚠️  Important: Save these wallet addresses and their private keys securely!');
      console.log('   Private keys are encrypted and stored locally.');
    } else {
      console.log(`❌ Failed to create wallets: ${result.error}`);
    }
  } catch (error) {
    console.error('❌ Error creating wallets:', error);
  }
}

async function listWallets(userId) {
  try {
    console.log('🔄 Loading wallets...');
    const result = await WalletService.getWallets(userId);

    if (result.success) {
      const wallets = result.data.wallets;
      if (wallets.length === 0) {
        console.log('📭 No wallets found. Create some wallets first.');
        return;
      }

      console.log(`📋 Found ${wallets.length} wallet(s):`);
      console.log('');
      wallets.forEach((wallet, index) => {
        console.log(`${index + 1}. ${wallet.address}`);
        console.log(`   Balance: ${wallet.balance} BNB`);
        console.log(`   Created: ${wallet.createdAt.toLocaleDateString()}`);
        if (wallet.lastUsed) {
          console.log(`   Last Used: ${wallet.lastUsed.toLocaleDateString()}`);
        }
        console.log('');
      });
    } else {
      console.log(`❌ Failed to load wallets: ${result.error}`);
    }
  } catch (error) {
    console.error('❌ Error loading wallets:', error);
  }
}

async function checkBalances(userId) {
  try {
    console.log('🔄 Checking wallet balances...');
    const balances = await WalletService.checkWalletBalances(userId);

    console.log('💰 Wallet Balance Summary:');
    console.log(`   Total Wallets: ${balances.totalWallets}`);
    console.log(`   Funded Wallets: ${balances.fundedWallets}`);
    console.log(`   Total Balance: ${balances.totalBalance.toFixed(6)} BNB`);
    console.log(`   Average Balance: ${balances.averageBalance.toFixed(6)} BNB`);
    console.log('');

    if (balances.unfundedWallets.length > 0) {
      console.log('⚠️  Unfunded Wallets:');
      balances.unfundedWallets.forEach((address, index) => {
        console.log(`   ${index + 1}. ${address}`);
      });
      console.log('');
    }

    console.log('💡 Recommendations:');
    balances.recommendations.forEach(rec => {
      console.log(`   ${rec}`);
    });
  } catch (error) {
    console.error('❌ Error checking balances:', error);
  }
}

async function getStats(userId) {
  try {
    console.log('🔄 Getting wallet statistics...');
    const result = await WalletService.getUserStats(userId);

    if (result.success) {
      const stats = result.data;
      console.log('📊 Wallet Statistics:');
      console.log(`   Total Wallets: ${stats.totalWallets}`);
      console.log(`   Wallets with Balance: ${stats.walletsWithBalance}`);
      console.log(`   Total Balance: ${stats.totalBalance} BNB`);
      console.log(`   Last Activity: ${stats.lastActivity.toLocaleDateString()}`);
    } else {
      console.log(`❌ Failed to get statistics: ${result.error}`);
    }
  } catch (error) {
    console.error('❌ Error getting statistics:', error);
  }
}

async function deleteWallet(userId) {
  try {
    const address = await question('Enter wallet address to delete: ');
    
    if (!address || !address.startsWith('0x') || address.length !== 42) {
      console.log('❌ Invalid wallet address format.');
      return;
    }

    const confirm = await question(`Are you sure you want to delete wallet ${address}? (y/n): `);
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log('❌ Deletion cancelled.');
      return;
    }

    console.log('🔄 Deleting wallet...');
    const result = await WalletService.deleteWallet(userId, address);

    if (result.success) {
      console.log('✅ Wallet deleted successfully.');
    } else {
      console.log(`❌ Failed to delete wallet: ${result.error}`);
    }
  } catch (error) {
    console.error('❌ Error deleting wallet:', error);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Goodbye!');
  rl.close();
  process.exit(0);
});

// Start the wallet management
main().catch(error => {
  console.error('❌ Error:', error);
  rl.close();
  process.exit(1);
});


