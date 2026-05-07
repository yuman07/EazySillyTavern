'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let dictionary = null;
let currentLocale = 'en';

function loadResource(locale) {
  const file = path.join(app.getAppPath(), 'i18n', `${locale}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function init() {
  const sysLocale = (app.getLocale() || 'en').toLowerCase();
  currentLocale = sysLocale.startsWith('zh') ? 'zh' : 'en';
  try {
    dictionary = loadResource(currentLocale);
  } catch (e) {
    currentLocale = 'en';
    dictionary = loadResource('en');
  }
}

function t(key, vars) {
  if (!dictionary) init();
  let value = dictionary[key];
  if (value === undefined) value = key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return value;
}

function getLocale() {
  if (!dictionary) init();
  return currentLocale;
}

function getAllStrings() {
  if (!dictionary) init();
  return { ...dictionary };
}

module.exports = { init, t, getLocale, getAllStrings };
