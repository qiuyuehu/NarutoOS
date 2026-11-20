import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const catalog=JSON.parse(fs.readFileSync('src/shared/messages.json','utf8'));
const languages=['zh-CN','en','pt-BR'];
const slots=text=>[...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m=>m[1]).sort();
for(const [key,entry] of Object.entries(catalog)) {
  for(const language of languages) {
    assert.equal(typeof entry[language],'string',`${key}: missing ${language}`);
    assert(entry[language].trim(),`${key}: empty ${language}`);
    assert.deepEqual(slots(entry[language]),slots(entry['zh-CN']),`${key}: placeholders differ in ${language}`);
  }
}
function scan(directory) {
  for(const item of fs.readdirSync(directory,{withFileTypes:true})) {
    const file=path.join(directory,item.name);
    if(item.isDirectory())scan(file);
    else if(/\.(?:ts|swift|html)$/.test(file)) {
      const text=fs.readFileSync(file,'utf8');
      for(const match of text.matchAll(/\bmsg\(['"]([^'"]+)['"]|data-i18n(?:-(?:title|aria-label|placeholder))?="([^"]+)"/g))assert(catalog[match[1]||match[2]],`${file}: unknown key ${match[1]||match[2]}`);
    }
  }
}
scan('src');
assert(fs.readFileSync('scripts/build.mjs','utf8').includes("cp('src/shared/messages.json', 'dist/shared/messages.json')"));
assert(fs.readFileSync('scripts/package-native.mjs','utf8').includes("'shared/messages.json'"));
console.log(`PASS ${Object.keys(catalog).length} shared messages: three languages, placeholders and resource routes`);
