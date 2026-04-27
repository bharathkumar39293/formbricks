import fs from 'fs';
const content = fs.readFileSync('apps/web/modules/ui/components/date-picker/index.tsx', 'utf-8');
const patterns = [
  /\bt\s*\(\s*['"]([^'"]+)['"]/g,
  /\bt\s*\(\s*`([^`]+)`/g,
  /i18nKey\s*=\s*['"]([^'"]+)['"]/g,
  /i18nKey\s*=\s*\{\s*['"]([^'"]+)['"]\s*\}/g,
];
const keys = [];
patterns.forEach(p => {
  let match;
  while ((match = p.exec(content)) !== null) {
    keys.push(match[1]);
  }
});
console.log('Found keys:', keys);
