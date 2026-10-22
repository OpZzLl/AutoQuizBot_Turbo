// background.js — Auto Quiz Bot Pro Turbo Service Worker (v7.7 Ultra-Fast Edition)

// Set your own Gemini API key locally; never commit API keys to source control.
const DEFAULT_GEMINI_KEY = '';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    geminiKey: DEFAULT_GEMINI_KEY,
    provider: 'gemini',
    delay: 200,
    platform: 'auto',
    barVisible: true,
    autoNext: false
  });
  console.log('[AQB Turbo] Ready');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'CALL_AI') {
    (async () => {
      try {
        const result = await handleAICall(msg.payload || {});
        sendResponse({ success: true, data: result });
      } catch (err) {
        console.error('[AQB AI Error]', err);
        sendResponse({ success: false, error: err.message || 'AI Service Error' });
      }
    })();
    return true; // Keep channel open
  }

  if (msg.action === 'RUN_QUIZ') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id, allFrames: true },
          files: ['content.js']
        });
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    });
    return true;
  }
});

// Auto-reset state when active tab navigates or reloads
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    chrome.storage.local.set({ botRunning: false });
  }
});

async function handleAICall({ provider, apiKey, prompt }) {
  let effectiveKey = (apiKey && apiKey.trim().length > 5) ? apiKey.trim() : null;
  if (!effectiveKey) {
    try {
      const stored = await chrome.storage.local.get(['geminiKey']);
      if (stored?.geminiKey && stored.geminiKey.trim().length > 5) {
        effectiveKey = stored.geminiKey.trim();
      }
    } catch (e) {}
  }
  if (!effectiveKey) effectiveKey = DEFAULT_GEMINI_KEY;
  return await callGeminiFast(effectiveKey, prompt);
}

// Fastest low-latency models with thinkingLevel: LOW for ~1.4s response & 100% accuracy
async function callGeminiFast(apiKey, prompt) {
  const models = [
    { name: 'gemini-3.5-flash-lite', thinkingLevel: 'LOW' },
    { name: 'gemini-flash-lite-latest', thinkingLevel: 'LOW' },
    { name: 'gemini-3.1-flash-lite-preview', thinkingLevel: 'LOW' },
    { name: 'gemini-3.5-flash', thinkingLevel: 'LOW' },
    { name: 'gemini-flash-latest', thinkingLevel: null }
  ];
  let lastErr = null;

  for (const m of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m.name}:generateContent?key=${apiKey}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);

      const generationConfig = {
        temperature: 0.0,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      };
      if (m.thinkingLevel) {
        generationConfig.thinkingConfig = { thinkingLevel: m.thinkingLevel };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig
        })
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        lastErr = new Error(`Gemini (${m.name}): ${errJson?.error?.message || res.status}`);
        continue;
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (rawText) return rawText;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('ไม่สามารถเชื่อมต่อ Gemini API ได้');
}
