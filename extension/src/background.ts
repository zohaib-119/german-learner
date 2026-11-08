// Adds a right-click entry on YouTube video pages that starts the same flow as the toolbar button.
const MENU_ID = 'create-learning-subtitles';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Create learning subtitles for this video',
    contexts: ['page', 'video'],
    documentUrlPatterns: ['https://www.youtube.com/watch*', 'https://m.youtube.com/watch*', 'https://www.youtube.com/shorts/*'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id !== undefined) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`job.html?tab=${tab.id}`) });
  }
});
