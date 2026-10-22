// popup.js — Auto Quiz Bot Pro Turbo (v8.2 Auto-Detect Edition)

document.addEventListener('DOMContentLoaded', () => {
  const autoDetectBtn = document.getElementById('btn-auto-detect');
  const startBtn = document.getElementById('btn-start-now');
  const submitBtn = document.getElementById('btn-submit-all');
  const nextBtn = document.getElementById('btn-next-now');
  const stopBtn = document.getElementById('btn-stop-now');
  const refreshBtn = document.getElementById('btn-refresh-tab');
  const resetBtn = document.getElementById('btn-reset-state');
  const speedSelect = document.getElementById('popup-speed');
  const autoSubmitChk = document.getElementById('chk-auto-submit');
  const autoNextChk = document.getElementById('chk-auto-next');
  const statusMsg = document.getElementById('status-msg');

  let isAutoDetectOn = false;

  // 1. Load saved settings & state
  chrome.storage.local.get(['delay', 'autoSubmit', 'autoNext', 'autoDetectActive'], (d) => {
    if (d.delay && speedSelect) {
      speedSelect.value = String(d.delay);
    }
    if (autoSubmitChk) {
      autoSubmitChk.checked = Boolean(d.autoSubmit);
    }
    if (autoNextChk) {
      autoNextChk.checked = Boolean(d.autoNext);
    }
    if (d.autoDetectActive) {
      setAutoDetectUI(true);
    }
  });

  // 2. Query active tab directly for real-time running state
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) {
      setRunningState(false);
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        setRunningState(false);
        statusMsg.textContent = '🟢 Gemini AI พร้อมทำงาน';
        statusMsg.className = 'msg-box done';
        chrome.storage.local.set({ botRunning: false });
      } else {
        setRunningState(Boolean(res.isRunning));
        if (res.autoDetectActive !== undefined) {
          setAutoDetectUI(Boolean(res.autoDetectActive));
        }
        statusMsg.textContent = res.text || (res.isRunning ? '⏳ กำลังประมวลผลข้อสอบ...' : '🟢 Gemini AI พร้อมทำงาน');
        statusMsg.className = 'msg-box ' + (res.type || (res.isRunning ? 'running' : 'done'));
      }
    });
  });

  function setRunningState(running) {
    if (running) {
      startBtn.textContent = '🔄 ทำซ้ำหน้านี้อีกครั้ง';
      stopBtn.style.display = 'block';
    } else {
      startBtn.textContent = '▶ ทำข้อสอบหน้านี้ทันที';
      startBtn.disabled = false;
      if (!isAutoDetectOn) {
        stopBtn.style.display = 'none';
      }
    }
  }

  function setAutoDetectUI(active) {
    isAutoDetectOn = active;
    if (active) {
      autoDetectBtn.textContent = '⏹️ ปิดโหมด Auto (กำลังเฝ้าตรวจจับ)';
      autoDetectBtn.className = 'btn-auto active';
      stopBtn.style.display = 'block';
    } else {
      autoDetectBtn.textContent = '🤖 เริ่มโหมด Auto (ทำทันทีเมื่อเจอข้อสอบ)';
      autoDetectBtn.className = 'btn-auto';
    }
  }

  // 3. Settings change handlers
  if (speedSelect) {
    speedSelect.addEventListener('change', () => {
      const newDelay = parseInt(speedSelect.value, 10);
      chrome.storage.local.set({ delay: newDelay });
      statusMsg.textContent = `⚡ ตั้งความเร็วเป็น: ${speedSelect.options[speedSelect.selectedIndex].text}`;
      statusMsg.className = 'msg-box done';
    });
  }

  if (autoSubmitChk) {
    autoSubmitChk.addEventListener('change', () => {
      const val = autoSubmitChk.checked;
      chrome.storage.local.set({ autoSubmit: val });
      statusMsg.textContent = val ? '⚡ เปิดระบบส่งคำตอบอัตโนมัติแล้ว' : '⚪ ปิดระบบส่งคำตอบอัตโนมัติ';
      statusMsg.className = 'msg-box done';
    });
  }

  if (autoNextChk) {
    autoNextChk.addEventListener('change', () => {
      const val = autoNextChk.checked;
      chrome.storage.local.set({ autoNext: val });
      statusMsg.textContent = val ? '⏩ เปิดโหมด Auto-Next (ทำควิซ + ถัดไปอัตโนมัติ)' : '⚪ ปิดโหมด Auto-Next';
      statusMsg.className = 'msg-box done';
    });
  }

  // 4. Main Auto Detect Button clicked
  if (autoDetectBtn) {
    autoDetectBtn.addEventListener('click', () => {
      const nextState = !isAutoDetectOn;
      setAutoDetectUI(nextState);
      chrome.storage.local.set({ autoDetectActive: nextState });

      if (nextState) {
        statusMsg.textContent = '🤖 เปิดโหมด Auto: กำลังตรวจจับข้อสอบ...';
        statusMsg.className = 'msg-box running';
      } else {
        statusMsg.textContent = '⚪ ปิดโหมด Auto ตรวจจับแล้ว';
        statusMsg.className = 'msg-box done';
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab?.id) return;

        chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_AUTO_DETECT', enable: nextState }, () => {
          if (chrome.runtime.lastError) {
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id, allFrames: true },
              files: ['content.js']
            }, () => {
              chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_AUTO_DETECT', enable: nextState });
            });
          }
        });
      });
    });
  }

  // 5. Start button clicked (Manual single-page solve)
  startBtn.addEventListener('click', async () => {
    setRunningState(true);
    statusMsg.textContent = '⏳ กำลังสแกนหน้าเว็บ...';
    statusMsg.className = 'msg-box running';

    if (speedSelect) {
      chrome.storage.local.set({ delay: parseInt(speedSelect.value, 10) });
    }

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        statusMsg.textContent = '❌ ไม่พบแท็บที่กำลังเปิดอยู่';
        statusMsg.className = 'msg-box error';
        setRunningState(false);
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_START' }, () => {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id, allFrames: true },
            files: ['content.js']
          }, () => {
            chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_START' });
          });
        }
      });
    });
  });

  // 6. Submit All button clicked
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      statusMsg.textContent = '🚀 กำลังกดส่งคำตอบทั้งหมด...';
      statusMsg.className = 'msg-box running';

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab?.id) return;

        chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_SUBMIT' }, () => {
          if (chrome.runtime.lastError) {
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id, allFrames: true },
              files: ['content.js']
            }, () => {
              chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_SUBMIT' });
            });
          }
        });
      });
    });
  }

  // 7. Next Unit button clicked
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      statusMsg.textContent = '⏩ กำลังกด Next ไปยังหน้าถัดไป...';
      statusMsg.className = 'msg-box running';

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab?.id) return;

        chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_NEXT' }, () => {
          if (chrome.runtime.lastError) {
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id, allFrames: true },
              files: ['content.js']
            }, () => {
              chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_NEXT' });
            });
          }
        });
      });
    });
  }

  // 8. Stop button clicked
  stopBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'TRIGGER_STOP' });
      }
    });
    setRunningState(false);
    setAutoDetectUI(false);
    statusMsg.textContent = '⬛ หยุดการทำงานทั้งหมดแล้ว';
    statusMsg.className = 'msg-box error';
    chrome.storage.local.set({ botRunning: false, autoPilotActive: false, autoDetectActive: false });
  });

  // 9. Reset state button clicked (Force unlock)
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'TRIGGER_STOP' });
        }
      });
      chrome.storage.local.set({
        botRunning: false,
        autoPilotActive: false,
        autoDetectActive: false,
        lastStatus: '🟢 รีเซ็ตสถานะเรียบร้อย (พร้อมทำงาน)',
        lastStatusType: 'done'
      });
      setRunningState(false);
      setAutoDetectUI(false);
      statusMsg.textContent = '🟢 รีเซ็ตสถานะเรียบร้อย (พร้อมทำงาน)';
      statusMsg.className = 'msg-box done';
    });
  }

  // 10. Refresh page button clicked
  refreshBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'TRIGGER_STOP' });
        chrome.storage.local.set({ botRunning: false, autoPilotActive: false });
        chrome.tabs.reload(tabs[0].id);
        statusMsg.textContent = '🔄 กำลังรีเฟรชหน้าเว็บ...';
        statusMsg.className = 'msg-box running';
        setTimeout(() => window.close(), 600);
      }
    });
  });

  // 11. Listen for live status broadcasts from content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'STATUS_UPDATE') {
      statusMsg.textContent = msg.text;
      statusMsg.className = 'msg-box ' + (msg.type || '');
      if (msg.isRunning !== undefined) {
        setRunningState(msg.isRunning);
      }
      if (msg.autoDetectActive !== undefined) {
        setAutoDetectUI(Boolean(msg.autoDetectActive));
      }
    }
  });
});
