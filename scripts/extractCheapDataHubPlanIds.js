const https = require('https');
https.get('https://www.cheapdatahub.ng/api/plan-ids/', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    const rows = [];
    const re = /<td class="col-network">([^<]+)<\/td>\s*<td class="col-service">([^<]+)<\/td>\s*<td class="col-name">([^<]+)<\/td>\s*<td class="col-planid"><code>(\d+)<\/code><\/td>/gs;
    let match;
    while ((match = re.exec(data)) !== null) {
      rows.push({
        network: match[1].trim(),
        service: match[2].trim(),
        name: match[3].trim(),
        planid: match[4].trim()
      });
    }
    console.log(JSON.stringify(rows, null, 2));
  });
}).on('error', (err) => {
  console.error(err);
  process.exit(1);
});
