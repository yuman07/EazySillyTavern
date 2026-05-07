'use strict';

const root = document.getElementById('root');
const statusEl = document.getElementById('status');
const titleEl = document.getElementById('title');
const errorTitleEl = document.getElementById('errorTitle');
const errorMessageEl = document.getElementById('errorMessage');
const btnViewLog = document.getElementById('btnViewLog');
const btnQuit = document.getElementById('btnQuit');

function applyStrings(strings) {
  if (strings['splash.title']) {
    titleEl.textContent = strings['splash.title'];
    document.title = strings['splash.title'];
  }
  if (strings['splash.error.title']) errorTitleEl.textContent = strings['splash.error.title'];
  if (strings['splash.error.viewLog']) btnViewLog.textContent = strings['splash.error.viewLog'];
  if (strings['splash.error.quit']) btnQuit.textContent = strings['splash.error.quit'];
}

window.eazyApi.onStrings((strings) => {
  applyStrings(strings);
});

window.eazyApi.onStatus((message) => {
  statusEl.textContent = message;
});

window.eazyApi.onError((message) => {
  errorMessageEl.textContent = message;
  root.classList.remove('state-loading');
  root.classList.add('state-error');
});

btnViewLog.addEventListener('click', () => { window.eazyApi.viewLog(); });
btnQuit.addEventListener('click', () => { window.eazyApi.quit(); });

window.eazyApi.requestStrings();
