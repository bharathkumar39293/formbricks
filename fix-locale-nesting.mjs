import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const localeDir = "apps/web/locales";
const newKeys = {
  "date_picker.pick_a_date": "Pick a date",
  "date_picker.clear_date": "Clear date",
  "date_picker.start_time": "Start time",
  "date_picker.end_time": "End time"
};

const files = readdirSync(localeDir).filter((f) => f.endsWith(".json"));

function setNestedKey(obj, keyPath, value) {
  const parts = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function deleteTopLevelKey(obj, key) {
  if (key in obj) {
    delete obj[key];
    return true;
  }
  return false;
}

for (const file of files) {
  const filePath = join(localeDir, file);
  const json = JSON.parse(readFileSync(filePath, "utf-8"));
  let changed = false;

  // 1. Move flat keys to nested keys under 'common'
  for (const [subKey, value] of Object.entries(newKeys)) {
    const fullKey = `common.${subKey}`;
    // Remove if it exists as a flat top-level key (cleanup from previous attempt)
    if (deleteTopLevelKey(json, fullKey)) {
      changed = true;
    }
    // Set as nested key
    setNestedKey(json, fullKey, value);
    changed = true;
  }

  if (changed) {
    // We'll write it back. Nesting is now correct.
    writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n", "utf-8");
    console.log(`Updated: ${file}`);
  }
}
