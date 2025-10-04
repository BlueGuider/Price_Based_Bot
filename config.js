const fs = require('fs');
const path = require('path');

function loadConfig() {
  const configPath = path.join(__dirname, 'price-trading-config.json');
  if (fs.existsSync(configPath)) {
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  }
  return {};
}

function saveConfig(config) {
  const configPath = path.join(__dirname, 'price-trading-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

module.exports = { loadConfig, saveConfig };
