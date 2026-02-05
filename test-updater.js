// Test script to check what electron-updater sees from GitHub
const https = require('https');

const owner = 'Agrysif';
const repo = 'WatchTwitch';
const versions = ['1.0.6', '1.0.10', '1.0.11'];

console.log('Testing latest.yml files on GitHub\n');

versions.forEach(version => {
  const url = `https://github.com/${owner}/${repo}/releases/download/v${version}/latest.yml`;
  
  console.log(`\nFetching: v${version}`);
  console.log(`URL: ${url}`);
  
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        console.log('Content:');
        console.log(data);
        
        // Try to parse it
        const lines = data.split('\n');
        const version = lines.find(l => l.startsWith('version:'));
        const path = lines.find(l => l.startsWith('path:'));
        console.log('Parsed version:', version);
        console.log('Parsed path:', path);
      } catch (e) {
        console.error('Error parsing:', e.message);
      }
    });
  }).on('error', err => {
    console.error('Error:', err.message);
  });
});

setTimeout(() => process.exit(0), 5000);
