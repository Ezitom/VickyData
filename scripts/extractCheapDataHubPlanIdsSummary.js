const https = require('https');
https.get('https://www.cheapdatahub.ng/api/plan-ids/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const rows = [];
    const re = /<td class="col-network">([^<]+)<\/td>\s*<td class="col-service">([^<]+)<\/td>\s*<td class="col-name">([^<]+)<\/td>\s*<td class="col-planid"><code>(\d+)<\/code><\/td>/gs;
    let match;
    while ((match = re.exec(data)) !== null) {
      rows.push({network: match[1].trim(), service: match[2].trim(), name: match[3].trim(), planid: match[4].trim()});
    }
    const networks = [...new Set(rows.map(r => r.network))];
    console.log('Networks:', networks);
    console.log('Counts:', networks.map(n => ({network:n, count: rows.filter(r => r.network === n).length})));    
  });
}).on('error', (err) => {
  console.error(err);
  process.exit(1);
});
