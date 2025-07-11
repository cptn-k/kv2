// extract-code.js
// Usage: node extract-code.js /path/to/repo > codebase.json
// Recursively reads all .js files and outputs a JSON array of { path, content }

const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || '.';

async function walk(dir, fileList = []) {
  const files = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      await walk(fullPath, fileList);
    } else if (file.isFile() && (file.name.endsWith('.js') || file.name.endsWith('.json') || file.name.endsWith('.html'))) {
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      fileList.push({ path: path.relative(ROOT, fullPath), content });
    }
  }
  return fileList;
}

async function main() {
  const files = await walk(ROOT);
  console.log(JSON.stringify(files, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});