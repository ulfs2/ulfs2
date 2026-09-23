const fs = require('node:fs');
const path = require('node:path');

const outputDirectory = path.join(__dirname, 'public');
const assets = [
  'index.html',
  'kazaa.html',
  'kazaa-page.js',
  'kazaa-export.html',
  'dashboard.html',
  'form.html',
  'users.html',
  'login.html',
  'signup.html',
  'backup.html',
  'email-config.html',
  'email-config.js',
  'styles.css',
  'navbar.js',
  'script.js'
];

fs.mkdirSync(outputDirectory, { recursive: true });
for (const asset of assets) {
  fs.copyFileSync(path.join(__dirname, asset), path.join(outputDirectory, asset));
}

const headersContent = `/*
  Cache-Control: no-cache, must-revalidate
`;
fs.writeFileSync(path.join(outputDirectory, '_headers'), headersContent);
fs.writeFileSync(path.join(__dirname, '_headers'), headersContent);

console.log(`Prepared ${assets.length} public assets and _headers for Cloudflare Workers.`);
