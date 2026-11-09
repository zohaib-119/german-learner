// Adds right-click entries on YouTube video pages that start the same jobs as the toolbar buttons.
const MENUS: Record<string, { title: string; query: string }> = {
  'create-learning-subtitles': { title: 'Create learning subtitles for this video', query: '' },
  'create-lesson': { title: 'Create a lesson from this video', query: '&kind=lesson' },
};

chrome.runtime.onInstalled.addListener(() => {
  for (const [id, m] of Object.entries(MENUS)) {
    chrome.contextMenus.create({
      id,
      title: m.title,
      contexts: ['page', 'video'],
      documentUrlPatterns: ['https://www.youtube.com/watch*', 'https://m.youtube.com/watch*', 'https://www.youtube.com/shorts/*'],
    });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const m = MENUS[String(info.menuItemId)];
  if (m && tab?.id !== undefined) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`job.html?tab=${tab.id}${m.query}`) });
  }
});
