const fs = require('fs');
const path = require('path');

function searchForEmails(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === 'node_modules' || file === '.git') continue;
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      searchForEmails(fullPath);
    } else {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const matches = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        if (matches) {
          const uniqueMatches = [...new Set(matches)];
          for (const match of uniqueMatches) {
             console.log(`Found ${match} in ${fullPath}`);
          }
        }
      } catch (e) {
        // ignore binary files or read errors
      }
    }
  }
}

searchForEmails('c:/Users/William/Documents/Pegue a Promo Ai');
