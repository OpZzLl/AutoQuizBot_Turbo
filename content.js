// content.js — Auto Quiz Bot Pro Turbo (v8.3 Safe Auto-Pilot Edition)
// Direct in-memory execution, 100% clean webpage with zero injected clutter

(function() {
  if (window !== window.top) {
    try {
      if (window.top.document) return;
    } catch (e) {}
  }

  // Singleton guard
  if (window.__AQB_CONTROLLER__) {
    return;
  }

  let isRunning = false;
  let activeAbort = null;
  let isAutoDetectActive = false;
  let autoDetectObserver = null;
  let autoDetectInterval = null;
  let currentStatusText = '🟢 Gemini AI พร้อมทำงาน';
  let currentStatusType = 'done';

  window.__AQB_CONTROLLER__ = {
    start: () => startQuizExecution(),
    stop: () => stopQuizExecution(),
    submitAll: () => submitAllQuestions(),
    clickNext: () => clickNextButton(),
    toggleAutoDetect: (en) => toggleAutoDetect(en),
    getStatus: () => ({ isRunning, autoDetectActive: isAutoDetectActive, text: currentStatusText, type: currentStatusType })
  };

  if (window === window.top) {
    try {
      chrome.storage?.local?.set({
        botRunning: false,
        lastStatus: currentStatusText,
        lastStatusType: currentStatusType
      });
    } catch (e) {}
  }

  try {
    document.querySelectorAll('#aqb-bar, #aqb-toggle, #aqb-style').forEach(el => el.remove());
  } catch (e) {}

  // ─── 1. Status Broadcaster (To Popup & Storage) ───────────────────────────
  function setStatus(text, type = '') {
    currentStatusText = text;
    currentStatusType = type;
    console.log('[AQB]', text);
    try {
      chrome.storage?.local?.set({
        lastStatus: text,
        lastStatusType: type,
        botRunning: isRunning,
        autoDetectActive: isAutoDetectActive
      });
      chrome.runtime?.sendMessage?.({
        action: 'STATUS_UPDATE',
        text,
        type,
        isRunning,
        autoDetectActive: isAutoDetectActive
      }, () => {
        if (chrome.runtime.lastError) {}
      });
    } catch (e) {}
  }

  function stopQuizExecution() {
    isRunning = false;
    disableAutoDetect();
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
    try {
      chrome.storage?.local?.set({ botRunning: false, autoPilotActive: false, autoDetectActive: false });
    } catch (e) {}
    setStatus('⬛ หยุดการทำงานทั้งหมดแล้ว', 'error');
  }

  function extractCleanLabel(lbl) {
    if (!lbl) return '';
    if (typeof lbl === 'string') {
      return lbl
        .replace(/choice\s*\d+\s*of\s*\d+\s*[:\-]?\s*/gi, '')
        .replace(/\(\d+(\.\d+)?\s*points?\s*(possible|graded)?\)/gi, '')
        .replace(/^(incorrect|correct)\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    try {
      const clone = lbl.cloneNode(true);
      clone.querySelectorAll('.sr, .status, .sr-only, script, style, .action, input').forEach(s => s.remove());
      let txt = clone.textContent || clone.innerText || '';
      return txt
        .replace(/choice\s*\d+\s*of\s*\d+\s*[:\-]?\s*/gi, '')
        .replace(/\(\d+(\.\d+)?\s*points?\s*(possible|graded)?\)/gi, '')
        .replace(/^(incorrect|correct)\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    } catch (e) {
      return (lbl.textContent || lbl.innerText || '').replace(/\s+/g, ' ').trim();
    }
  }

  function cleanLabel(str) {
    return (str || '')
      .replace(/^([A-Da-d1-9]|[ก-ฮ])[\.\)\:\-]\s*/, '')
      .replace(/choice\s*\d+\s*of\s*\d+\s*[:\-]?\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatCloneCodeAndText(clone, doc) {
    clone.querySelectorAll('script, style, .status, .sr, .sr-only, .action').forEach(el => el.remove());

    clone.querySelectorAll('pre').forEach(preEl => {
      const cText = (preEl.innerText || preEl.textContent || '').trim();
      if (cText) {
        preEl.replaceWith(doc.createTextNode('\n```python\n' + cText + '\n```\n'));
      }
    });

    clone.querySelectorAll('code').forEach(codeEl => {
      const cText = (codeEl.innerText || codeEl.textContent || '').trim();
      if (cText) {
        if (cText.includes('\n')) {
          codeEl.replaceWith(doc.createTextNode('\n```python\n' + cText + '\n```\n'));
        } else {
          codeEl.replaceWith(doc.createTextNode('`' + cText + '`'));
        }
      }
    });
  }

  function parseOptionIndex(val) {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return Math.max(0, val - 1);
    const s = String(val).trim();
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 1) return n - 1;
    const upper = s.toUpperCase();
    if (upper === 'A' || upper === 'ก') return 0;
    if (upper === 'B' || upper === 'ข') return 1;
    if (upper === 'C' || upper === 'ค') return 2;
    if (upper === 'D' || upper === 'ง') return 3;
    if (upper === 'E' || upper === 'จ') return 4;
    return 0;
  }

  function clearPreviousHighlights() {
    try {
      document.querySelectorAll('[data-aqb-highlighted="true"]').forEach(el => {
        el.style.outline = '';
        el.style.backgroundColor = '';
        el.removeAttribute('data-aqb-highlighted');
      });
    } catch (e) {}
  }

  // ─── 2. Safe Question Loader (Never skip a loading quiz) ────────────────────
  async function waitForQuestionsToLoad(maxWaitMs = 3500) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const q = extractAllQuestions();
      if (q.length > 0) return q;

      // Check if page contains a problem block or loading animation that is still rendering
      const isProblemBlock = document.querySelector('.xblock-type-problem, .problem, .capa_inputtype, .wrapper-problem-response, .loading-animation, [aria-busy="true"]');
      await new Promise(r => setTimeout(r, isProblemBlock ? 400 : 250));
    }
    return extractAllQuestions();
  }

  // ─── 3. Ultra-Fast Parallel Quiz Execution ─────────────────────────────────
  async function startQuizExecution() {
    if (isRunning) return;

    let delayMs = 200;
    let autoSubmit = false;
    let autoNext = false;
    try {
      const stored = await chrome.storage.local.get(['delay', 'autoSubmit', 'autoNext']);
      if (stored && stored.delay !== undefined) delayMs = parseInt(stored.delay, 10);
      if (stored && stored.autoSubmit !== undefined) autoSubmit = Boolean(stored.autoSubmit);
      if (stored && stored.autoNext !== undefined) autoNext = Boolean(stored.autoNext);
    } catch (e) {}

    // 1. First check immediately
    let questions = extractAllQuestions();

    // 2. If 0 questions, wait up to 3.5s for Open edX / LMS to finish AJAX rendering before deciding!
    if (questions.length === 0) {
      setStatus('🔍 กำลังรอโหลดข้อสอบในหน้าเว็บ...', 'running');
      questions = await waitForQuestionsToLoad(3500);
    }

    // 3. Double-check: if a problem container exists on screen, wait an extra 1.5s
    if (questions.length === 0) {
      const hasProblem = document.querySelector('.xblock-type-problem, .problem, .wrapper-problem-response, .capa_inputtype');
      if (hasProblem) {
        await new Promise(r => setTimeout(r, 1500));
        questions = extractAllQuestions();
      }
    }

    // 4. If STILL 0 questions after waiting, ONLY THEN check autoNext or idle
    if (questions.length === 0) {
      if (autoNext) {
        setStatus('⏩ หน้านี้ไม่มีควิซ (เป็นวิดีโอหรือเนื้อหา) — ข้ามไปหน้าถัดไป...', 'running');
        await new Promise(r => setTimeout(r, 1200));
        const moved = clickNextButton();
        if (!moved) {
          setStatus('🏁 สิ้นสุดบทเรียนแล้ว (ไม่พบหน้าถัดไป)', 'done');
          try { chrome.storage?.local?.set({ autoPilotActive: false, botRunning: false }); } catch (e) {}
        }
        return;
      }
      if (isAutoDetectActive) {
        setStatus('👀 โหมด Auto: กำลังเฝ้ารอข้อสอบ... (เมื่อเจอจะทำทันที)', 'running');
        return;
      }
      if (window === window.top) {
        setStatus('⚠️ ไม่พบคำถามในหน้านี้ — กรุณารีเฟรช F5 แล้วลองใหม่', 'error');
      }
      return;
    }

    // Questions ARE found! Lock execution state and SOLVE THEM!
    isRunning = true;
    clearPreviousHighlights();

    if (autoNext) {
      try { chrome.storage?.local?.set({ autoPilotActive: true }); } catch (e) {}
    }

    try {
      const totalQ = questions.length;
      const CHUNK_SIZE = 6;
      const totalBatches = Math.ceil(totalQ / CHUNK_SIZE);

      activeAbort = new AbortController();
      const signal = activeAbort.signal;

      setStatus(`⚡ พบ ${totalQ} ข้อ — กำลังประมวลผลด้วยความเร็วสูง...`, 'running');

      const batchTasks = [];
      for (let b = 0; b < totalBatches; b++) {
        const startIdx = b * CHUNK_SIZE;
        const endIdx = Math.min(startIdx + CHUNK_SIZE, totalQ);
        const chunk = questions.slice(startIdx, endIdx);
        const prompt = buildChunkPrompt(chunk, startIdx);

        const promise = callBackgroundAI(prompt, signal).then(raw => ({
          chunk,
          startIdx,
          answers: parseFastAnswers(raw, chunk, startIdx)
        }));
        batchTasks.push(promise);
      }

      for (let b = 0; b < batchTasks.length; b++) {
        if (!isRunning) break;

        const { chunk, startIdx, answers } = await batchTasks[b];
        if (!isRunning) break;

        for (let i = 0; i < chunk.length; i++) {
          if (!isRunning) break;
          const globalIdx = startIdx + i;
          const q = chunk[i];
          const ans = answers[i] || { selected: 1, selectedText: '' };

          const selectedList = Array.isArray(ans.selected)
            ? (q.isMulti ? ans.selected : [ans.selected[0] || 1])
            : [ans.selected || 1];

          for (const selItem of selectedList) {
            if (!isRunning) break;
            let optIdx = parseOptionIndex(selItem);

            if (ans.selectedText && q.options && selectedList.length === 1) {
              const tText = ans.selectedText.trim();
              const cText = cleanLabel(tText);

              const currentOptLabel = q.options[optIdx] ? cleanLabel(q.options[optIdx].label) : '';
              const currentMatches = currentOptLabel === cText || currentOptLabel.toLowerCase() === cText.toLowerCase();

              if (!currentMatches) {
                let matchIdx = q.options.findIndex(o => o.label.trim() === tText || cleanLabel(o.label) === cText);

                if (matchIdx === -1) {
                  matchIdx = q.options.findIndex(o => cleanLabel(o.label).toLowerCase() === cText.toLowerCase());
                }

                if (matchIdx === -1 && cText.length > 5) {
                  matchIdx = q.options.findIndex(o => {
                    const cl = cleanLabel(o.label);
                    return cl.length > 5 && (cl.includes(cText) || cText.includes(cl));
                  });
                }

                if (matchIdx !== -1) optIdx = matchIdx;
              }
            }

            optIdx = Math.max(0, Math.min(optIdx, q.options.length - 1));
            const target = q.options[optIdx];

            if (target && target.element) {
              clickOptionReliably(target.element, delayMs <= 350);
              highlightOption(target.element);
              setStatus(`✓ ข้อ ${globalIdx + 1}/${totalQ}: ${target.label.substring(0, 25)}`, 'running');
            }
          }

          try {
            const cur = await chrome.storage.local.get(['delay']);
            if (cur?.delay !== undefined) delayMs = parseInt(cur.delay, 10);
          } catch (e) {}

          if (globalIdx < totalQ - 1 && delayMs > 0) {
            await new Promise(r => setTimeout(r, delayMs));
          }
        }
      }

      if (!isRunning) return;

      // Auto-Submit step if enabled
      if (autoSubmit) {
        setStatus(`🎉 ตอบครบ ${totalQ} ข้อแล้ว! กำลังส่งคำตอบอัตโนมัติ...`, 'running');
        await new Promise(r => setTimeout(r, 400));
        await submitAllQuestions();
      } else {
        setStatus(`🎉 ตอบครบทั้ง ${totalQ} ข้อแล้ว! (สำเร็จ)`, 'done');
      }

      // Auto-Next step if enabled (Only AFTER answers are solved & submitted!)
      if (autoNext) {
        setStatus(`⏩ กำลังเปลี่ยนไปหน้าถัดไปอัตโนมัติ (Next Unit)...`, 'running');
        await new Promise(r => setTimeout(r, 1800));
        const moved = clickNextButton();
        if (!moved) {
          setStatus(`🏁 ทำเสร็จครบทุกหน้าแล้ว! (ไม่มีหน้าถัดไป)`, 'done');
          try { chrome.storage?.local?.set({ autoPilotActive: false, botRunning: false }); } catch (e) {}
        }
      } else {
        isRunning = false;
        try { chrome.storage?.local?.set({ botRunning: false }); } catch (e) {}
      }

    } catch (err) {
      if (err.name === 'AbortError' || !isRunning) {
        setStatus('⬛ หยุดการทำงานแล้ว', 'error');
      } else {
        console.error('[AQB Error]', err);
        setStatus('❌ ' + (err.message || 'เกิดข้อผิดพลาด'), 'error');
      }
      isRunning = false;
      try { chrome.storage?.local?.set({ botRunning: false, autoPilotActive: false }); } catch (e) {}
    }
  }

  // ─── 4. Precision Question Extractor ────────────────────────────────────────
  function extractAllQuestions() {
    const questions = [];
    const docs = [document];

    document.querySelectorAll('iframe').forEach(f => {
      try {
        const idoc = f.contentDocument || f.contentWindow?.document;
        if (idoc && !docs.includes(idoc)) docs.push(idoc);
      } catch (e) {}
    });

    const selector = [
      'input[type="radio"]:not([disabled])',
      'input[type="checkbox"]:not([disabled])',
      '[role="radio"]:not([aria-disabled="true"])',
      '[role="checkbox"]:not([aria-disabled="true"])'
    ].join(', ');

    docs.forEach(doc => {
      const allInputs = Array.from(doc.querySelectorAll(selector)).filter(el => {
        return !el.closest('#discussions, .discussion-module, .forum, footer, nav, header, #aqb-bar');
      });

      if (allInputs.length === 0) return;

      const nameGroups = {};
      allInputs.forEach((r, idx) => {
        let key = null;
        if (r.tagName === 'INPUT' && r.name && r.name.trim().length > 0) {
          key = r.name;
        } else {
          const container = r.closest('.choicegroup, .capa_inputtype, fieldset, [role="radiogroup"], div[role="listitem"], .form-question, .que') || r.parentElement;
          if (container) {
            key = container.id || (container._aqbId || (container._aqbId = 'grp_' + Math.floor(idx / 4)));
          } else {
            key = 'grp_' + Math.floor(idx / 4);
          }
        }
        if (!nameGroups[key]) nameGroups[key] = [];
        nameGroups[key].push(r);
      });

      Object.entries(nameGroups).forEach(([name, inputs]) => {
        if (inputs.length < 2) return;

        const firstInput = inputs[0];
        const isMulti = firstInput.type === 'checkbox' || firstInput.getAttribute('role') === 'checkbox';

        const options = inputs.map((input, oIdx) => {
          let labelText = '';
          if (input.tagName === 'INPUT') {
            let lbl = (input.labels && input.labels.length > 0) ? input.labels[0] : null;
            if (!lbl && input.id) {
              try {
                lbl = doc.querySelector(`label[for="${CSS.escape(input.id)}"]`);
              } catch (e) {}
            }
            if (!lbl) lbl = input.closest('label');
            if (!lbl && input.parentElement) {
              lbl = input.parentElement.querySelector('label') || input.parentElement;
            }
            labelText = extractCleanLabel(lbl);
          } else {
            labelText = extractCleanLabel(input.getAttribute('aria-label') || input.innerText || input.textContent || '');
          }

          if (!labelText) labelText = `ตัวเลือก ${oIdx + 1}`;

          return {
            element: input,
            label: labelText,
            index: oIdx
          };
        }).filter(o => o.label.length > 0);

        if (options.length < 2) return;

        let qText = '';

        // Strategy 1: Dedicated question card (Google Forms / Moodle / Canvas)
        const questionCard = firstInput.closest('div[role="listitem"], .form-question, .que, .question_holder, .quiz-question');
        if (questionCard) {
          const titleEl = questionCard.querySelector('div[role="heading"], .M7eMe, .qtext, .question_text');
          if (titleEl) {
            try {
              const clone = titleEl.cloneNode(true);
              formatCloneCodeAndText(clone, doc);
              qText = (clone.innerText || clone.textContent || '').trim();
            } catch (e) {
              qText = titleEl.innerText.trim();
            }
          }
        }

        // Strategy 2: Open edX & General LMS
        const choiceContainer = firstInput.closest('.choicegroup, .capa_inputtype, [role="radiogroup"]')
                             || firstInput.closest('fieldset')
                             || firstInput.parentElement;

        if (!qText && choiceContainer) {
          // 2a. Check <legend> inside fieldset/choicegroup
          const legend = choiceContainer.querySelector('legend, .response-fieldset-legend, .field-group-hd');
          if (legend) {
            try {
              const lClone = legend.cloneNode(true);
              formatCloneCodeAndText(lClone, doc);
              const lText = (lClone.innerText || lClone.textContent || '').trim();
              if (lText.length > 3) qText = lText;
            } catch (e) {}
          }

          // 2b. Climb up to outermost single-question wrapper (Open edX .wrapper-problem-response)
          let blockContainer = choiceContainer;
          while (
            blockContainer.parentElement &&
            blockContainer.parentElement !== doc.body &&
            !blockContainer.parentElement.classList.contains('problem') &&
            !blockContainer.parentElement.classList.contains('que') &&
            (blockContainer.parentElement.classList.contains('wrapper-problem-response') || blockContainer.parentElement.children.length === 1)
          ) {
            blockContainer = blockContainer.parentElement;
          }

          // 2c. Walk backwards from blockContainer to find question text & code blocks
          let textParts = qText ? [qText] : [];
          let curr = blockContainer.previousElementSibling;
          let steps = 0;

          while (curr && steps < 10) {
            steps++;
            if (
              curr.querySelector('input[type="radio"], input[type="checkbox"], [role="radio"]') ||
              curr.classList.contains('choicegroup') ||
              curr.classList.contains('capa_inputtype') ||
              curr.classList.contains('wrapper-problem-response')
            ) {
              break;
            }

            const isHeader = curr.classList.contains('problem-header') || /^H[1-6]$/.test(curr.tagName);

            try {
              const clone = curr.cloneNode(true);
              formatCloneCodeAndText(clone, doc);

              const imgs = Array.from(clone.querySelectorAll('img')).map(m => m.alt || m.title).filter(Boolean);
              let extracted = (clone.innerText || clone.textContent || '').trim();
              if (imgs.length > 0) extracted += ' ' + imgs.map(a => `[รูปภาพ: ${a}]`).join(' ');

              if (extracted && !extracted.includes('points possible') && !extracted.includes('Bookmark this page')) {
                textParts.unshift(extracted);
              }
            } catch (e) {}

            if (isHeader) break;
            curr = curr.previousElementSibling;
          }

          if (textParts.length > 0) {
            qText = textParts.join('\n\n');
          }
        }

        // Strategy 3: Fallback to parent problem container
        if (!qText && choiceContainer) {
          const parent = choiceContainer.closest('.problem') || choiceContainer.parentElement;
          if (parent) {
            try {
              const clone = parent.cloneNode(true);
              clone.querySelectorAll('input, label, .choicegroup, .wrapper-problem-response, fieldset, button').forEach(el => el.remove());
              formatCloneCodeAndText(clone, doc);
              qText = (clone.innerText || clone.textContent || '').replace(/Bookmark this page|points possible.*|\(\d+ points?\)/gi, '').trim();
            } catch (e) {}
          }
        }

        if (!qText) qText = `คำถามข้อที่ ${questions.length + 1}`;

        questions.push({
          index: questions.length,
          text: qText,
          options,
          isMulti
        });
      });
    });

    return questions;
  }

  // ─── 5. Precision & Fast Chunk Prompt ───────────────────────────────────────
  function buildChunkPrompt(chunk, startIdx) {
    let prompt = `Solve these Python / Academic quiz questions with 100% accuracy.\n`;
    prompt += `Rules:\n`;
    prompt += `- Trace each loop iteration and if/else branch carefully in a brief 1-line "trace".\n`;
    prompt += `- 'and': True only if both True. 'or': True if at least one True (เมื่อมีเงื่อนไขอย่างน้อยหนึ่งฝั่งที่เป็นจริง). 'not': inverts boolean.\n`;
    prompt += `- '/' returns float (4/2 = 2.0), '//' returns int, '%' is remainder. Truthy: " " (space) and [0] are True; 0, "", [], None, False are False.\n`;
    prompt += `Output JSON: {"answers":[{"qNum":1,"trace":"brief trace","selected":2,"selectedText":"False"}]}\n\n`;

    chunk.forEach((q, i) => {
      prompt += `[Q${i + 1}]${q.isMulti ? ' (Multiple Choice)' : ''}:\n${q.text}\nOptions:\n`;
      q.options.forEach((opt, j) => {
        prompt += `${j + 1}. ${opt.label}\n`;
      });
      prompt += `\n`;
    });

    return prompt;
  }

  function parseFastAnswers(rawText, chunk, startIdx) {
    let clean = (rawText || '').replace(/```json|```/g, '').trim();
    let answersList = [];

    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        answersList = parsed;
      } else if (parsed && typeof parsed === 'object') {
        answersList = parsed.answers || parsed.questions || parsed.data || parsed.results || Object.values(parsed).find(v => Array.isArray(v)) || [];
      }
    } catch (e) {
      const match = clean.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        try { answersList = JSON.parse(match[0]); } catch (e2) {}
      }
    }

    if (answersList.length > 0) {
      return chunk.map((q, i) => {
        const batchNum = i + 1;
        const globalNum = startIdx + i + 1;
        const found = answersList.find(a => Number(a.qNum) === batchNum || Number(a.qNum) === globalNum) || answersList[i];
        return {
          selected: found ? (q.isMulti ? found.selected : (Array.isArray(found.selected) ? found.selected[0] : found.selected)) : 1,
          selectedText: found?.selectedText ? String(found.selectedText).trim() : '',
          trace: found?.trace || ''
        };
      });
    }

    const arrayMatch = clean.match(/\[\s*([\d,\s]+)\s*\]/);
    if (arrayMatch) {
      const numbers = arrayMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1);
      if (numbers.length > 0) {
        return chunk.map((_, i) => ({ selected: numbers[i] || 1, selectedText: '', trace: '' }));
      }
    }

    return chunk.map(() => ({ selected: 1, selectedText: '', trace: '' }));
  }

  // ─── 6. Fast AI Background Caller ──────────────────────────────────────────
  function callBackgroundAI(prompt, signal) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error('AI ตอบกลับช้าเกินไป — แนะนำกดเริ่มใหม่อีกครั้ง'));
        }
      }, 25000);

      if (signal) {
        signal.addEventListener('abort', () => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          }
        });
      }

      chrome.runtime.sendMessage({ action: 'CALL_AI', payload: { prompt } }, (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);

        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res || !res.success) return reject(new Error(res?.error || 'AI Failed'));
        resolve(res.data);
      });
    });
  }

  // ─── 7. Reliable Universal Clicker ─────────────────────────────────────────
  function clickOptionReliably(el, fastScroll = false) {
    try {
      const doc = el.ownerDocument || document;

      el.scrollIntoView?.({ behavior: fastScroll ? 'instant' : 'smooth', block: 'nearest' });

      let label = (el.labels && el.labels.length > 0) ? el.labels[0] : null;
      if (!label && el.id) {
        try {
          label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        } catch (e) {}
      }
      if (!label) label = el.closest('label');
      if (!label && el.parentElement) {
        label = el.parentElement.querySelector('label');
      }

      if (label) {
        label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        label.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        label.click();
      }

      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.click();

      if ('checked' in el) {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const role = el.getAttribute('role');
      if (role === 'radio' || role === 'checkbox') {
        el.setAttribute('aria-checked', 'true');
      }
    } catch (e) {}
  }

  function highlightOption(el) {
    try {
      const container = el.closest('div.field, label, li, div') || el;
      container.setAttribute('data-aqb-highlighted', 'true');
      container.style.transition = 'all 0.15s ease';
      container.style.outline = '2px solid #22c55e';
      container.style.borderRadius = '6px';
      container.style.backgroundColor = 'rgba(34, 197, 94, 0.15)';
    } catch (e) {}
  }

  // ─── 8. One-Click Universal Submit All System ──────────────────────────────
  async function submitAllQuestions() {
    setStatus('🔍 กำลังค้นหาปุ่ม Submit / ส่งคำตอบ...', 'running');

    const docs = [document];
    document.querySelectorAll('iframe').forEach(f => {
      try {
        const idoc = f.contentDocument || f.contentWindow?.document;
        if (idoc && !docs.includes(idoc)) docs.push(idoc);
      } catch (e) {}
    });

    const candidates = [];
    const selector = [
      'button.submit',
      'button.check',
      'button.btn-brand.submit',
      'button.submit-btn',
      'button[data-should-enable-submit-button]',
      'button[class*="submit"]',
      'button[class*="check"]',
      'input[type="submit"]',
      'input[type="button"][value*="ส่ง"]',
      'input[type="button"][value*="Submit"]',
      'input[type="button"][value*="Check"]',
      'div[role="button"][jsname="M2Action"]',
      '#submit_quiz_button',
      '.mod_quiz-next-nav input'
    ].join(', ');

    docs.forEach(d => {
      d.querySelectorAll(selector).forEach(el => candidates.push(el));

      d.querySelectorAll('button, div[role="button"], a.btn').forEach(el => {
        if (candidates.includes(el)) return;
        const txt = (el.innerText || el.textContent || '').trim();
        if (/^(submit|check|ส่งคำตอบ|ส่ง|ตรวจคำตอบ|บันทึกและส่ง|finish attempt|submit all and finish)$/i.test(txt)) {
          candidates.push(el);
        }
      });
    });

    const buttons = candidates.filter(el => {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      if (el.closest('.nav-btn, .pagination, header, nav, #discussions')) return false;
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (txt.includes('previous') || txt.includes('ย้อนกลับ') || txt.includes('back')) return false;
      return true;
    });

    if (buttons.length === 0) {
      setStatus('⚠️ ไม่พบปุ่ม Submit หรือตรวจคำตอบในหน้านี้', 'error');
      return;
    }

    setStatus(`🚀 พบ ${buttons.length} ปุ่ม — กำลังกดส่งคำตอบทั้งหมด...`, 'running');

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      try {
        btn.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        btn.click();

        btn.style.transition = 'all 0.2s ease';
        btn.style.outline = '3px solid #10b981';
        btn.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.5)';
      } catch (e) {}

      if (buttons.length > 1) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    setStatus(`🎉 กดส่งคำตอบเรียบร้อยแล้ว (${buttons.length} ปุ่ม)!`, 'done');
  }

  // ─── 9. Universal Next Unit / Next Step System ─────────────────────────────
  function findNextButton(doc = document) {
    const docs = [doc];
    doc.querySelectorAll('iframe').forEach(f => {
      try {
        const idoc = f.contentDocument || f.contentWindow?.document;
        if (idoc && !docs.includes(idoc)) docs.push(idoc);
      } catch (e) {}
    });

    const selector = [
      '.sequence-nav-button.button-next',
      'button.button-next',
      'a.button-next',
      '.sequence-nav-button[data-tooltip*="Next"]',
      '.sequence-nav-button[data-nav-direction="next"]',
      'button.next-btn',
      'a.next-btn',
      'a[rel="next"]',
      '.btn-next',
      '#next-button',
      '.mod_quiz-next-nav input',
      'div[role="button"][jsname="OCpkoe"]'
    ].join(', ');

    for (const d of docs) {
      const direct = d.querySelector(selector);
      if (direct && !direct.disabled && direct.getAttribute('aria-disabled') !== 'true' && !direct.classList.contains('disabled')) {
        return direct;
      }

      const all = d.querySelectorAll('button, a.btn, a, div[role="button"]');
      for (const el of all) {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled')) continue;
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (/^(next\s*>?>?|ถัดไป\s*>?>?|>|next\s*unit)$/i.test(txt)) {
          return el;
        }
      }
    }

    return null;
  }

  function clickNextButton() {
    const nextBtn = findNextButton(document);
    if (!nextBtn) {
      setStatus('⚠️ ไม่พบปุ่ม Next หรือหน้าถัดไปในหน้านี้', 'error');
      return false;
    }

    setStatus('⏩ กำลังเปลี่ยนไปหน้าถัดไป (Next)...', 'running');
    try {
      nextBtn.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      nextBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      nextBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      nextBtn.click();
      return true;
    } catch (e) {
      console.error('[AQB Next Error]', e);
      return false;
    }
  }

  // ─── 10. Smart Auto-Detect & Solve When Quiz Found ─────────────────────────
  function toggleAutoDetect(enable) {
    if (enable) {
      enableAutoDetect();
    } else {
      disableAutoDetect();
    }
  }

  function enableAutoDetect() {
    isAutoDetectActive = true;
    try { chrome.storage?.local?.set({ autoDetectActive: true }); } catch (e) {}

    // Check right now on current screen
    const curQ = extractAllQuestions();
    if (curQ.length > 0 && !isRunning) {
      setStatus(`🎯 ตรวจพบข้อสอบ ${curQ.length} ข้อ! เริ่มทำอัตโนมัติ...`, 'running');
      startQuizExecution();
      return;
    } else {
      setStatus('👀 โหมด Auto: กำลังเฝ้ารอข้อสอบ... (เมื่อเจอจะทำทันที)', 'running');
    }

    // Attach MutationObserver watching DOM for quiz inputs appearing
    if (!autoDetectObserver) {
      let debounceTimer = null;
      autoDetectObserver = new MutationObserver(() => {
        if (isRunning || !isAutoDetectActive) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (isRunning || !isAutoDetectActive) return;
          const q = extractAllQuestions();
          if (q.length > 0) {
            setStatus(`🎯 ตรวจพบข้อสอบ ${q.length} ข้อ! เริ่มทำอัตโนมัติ...`, 'running');
            startQuizExecution();
          }
        }, 800);
      });

      autoDetectObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    }

    // Polling interval backup (for dynamically loaded React/LMS components)
    if (!autoDetectInterval) {
      autoDetectInterval = setInterval(() => {
        if (isRunning || !isAutoDetectActive) return;
        const q = extractAllQuestions();
        if (q.length > 0) {
          setStatus(`🎯 ตรวจพบข้อสอบ ${q.length} ข้อ! เริ่มทำอัตโนมัติ...`, 'running');
          startQuizExecution();
        }
      }, 1200);
    }
  }

  function disableAutoDetect() {
    isAutoDetectActive = false;
    if (autoDetectObserver) {
      autoDetectObserver.disconnect();
      autoDetectObserver = null;
    }
    if (autoDetectInterval) {
      clearInterval(autoDetectInterval);
      autoDetectInterval = null;
    }
    try { chrome.storage?.local?.set({ autoDetectActive: false }); } catch (e) {}
  }

  // ─── 11. Listeners & Shortcuts ─────────────────────────────────────────────
  chrome.runtime.onMessage?.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'GET_STATUS') {
      if (window === window.top || isRunning) {
        sendResponse({ isRunning, autoDetectActive: isAutoDetectActive, text: currentStatusText, type: currentStatusType });
      }
      return;
    }
    if (msg.action === 'TRIGGER_AUTO_DETECT') {
      toggleAutoDetect(Boolean(msg.enable));
    }
    if (msg.action === 'TRIGGER_START') {
      startQuizExecution();
    }
    if (msg.action === 'TRIGGER_SUBMIT') {
      submitAllQuestions();
    }
    if (msg.action === 'TRIGGER_NEXT') {
      clickNextButton();
    }
    if (msg.action === 'TRIGGER_STOP') {
      stopQuizExecution();
    }
  });

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'AQB_DIRECT_START') {
      startQuizExecution();
    }
    if (e.data && e.data.type === 'AQB_DIRECT_SUBMIT') {
      submitAllQuestions();
    }
    if (e.data && e.data.type === 'AQB_DIRECT_NEXT') {
      clickNextButton();
    }
    if (e.data && e.data.type === 'AQB_DIRECT_STOP') {
      stopQuizExecution();
    }
  });

  window.addEventListener('keydown', (e) => {
    // Alt + A: Toggle Auto-Detect
    if (e.altKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      toggleAutoDetect(!isAutoDetectActive);
      setStatus(isAutoDetectActive ? '🤖 เปิดโหมด Auto ตรวจจับแล้ว' : '⚪ ปิดโหมด Auto ตรวจจับแล้ว', isAutoDetectActive ? 'running' : 'done');
    }
    // Alt + S: Start current page / Stop
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (isRunning) stopQuizExecution();
      else startQuizExecution();
    }
    // Alt + X: Submit all
    if (e.altKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      submitAllQuestions();
    }
    // Alt + N: Next
    if (e.altKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      clickNextButton();
    }
  });

  // ─── 12. Safe Auto-Pilot Across Navigation & Page Changes ──────────────────
  if (window === window.top) {
    let prevPageUrl = location.href;

    // Check on fresh page load if Auto-Detect or Auto-Pilot was active
    setTimeout(async () => {
      try {
        const stored = await chrome.storage?.local?.get(['autoDetectActive', 'autoPilotActive', 'autoNext']);
        if (stored?.autoDetectActive) {
          enableAutoDetect();
        } else if (stored?.autoPilotActive && stored?.autoNext) {
          setStatus('🤖 กำลังรันโหมด Auto-Pilot ต่อเนื่อง...', 'running');
          setTimeout(() => startQuizExecution(), 1500);
        }
      } catch (e) {}
    }, 1500);

    // Watch for SPA transitions in Open edX sequential navigation
    setInterval(async () => {
      if (location.href !== prevPageUrl) {
        prevPageUrl = location.href;
        try {
          const stored = await chrome.storage?.local?.get(['autoDetectActive', 'autoPilotActive', 'autoNext']);
          if (stored?.autoDetectActive || (stored?.autoPilotActive && stored?.autoNext)) {
            setStatus('🤖 ตรวจพบหน้าใหม่ — กำลังรอโหลดข้อสอบ...', 'running');
            setTimeout(async () => {
              if (isRunning) return;
              const q = await waitForQuestionsToLoad(3500);
              if (q.length > 0) {
                setStatus(`🎯 ตรวจพบข้อสอบ ${q.length} ข้อ! กำลังทำอัตโนมัติ...`, 'running');
                startQuizExecution();
              } else if (stored?.autoNext) {
                setStatus('⏩ หน้านี้ไม่มีควิซ — กำลังข้ามไปหน้าถัดไป...', 'running');
                await new Promise(r => setTimeout(r, 1200));
                clickNextButton();
              } else {
                setStatus('👀 โหมด Auto: กำลังเฝ้ารอข้อสอบ...', 'running');
              }
            }, 1500);
          } else {
            setStatus('🟢 พร้อมทำงาน (ตรวจพบหน้าใหม่)', 'done');
          }
        } catch (e) {}
      }
    }, 600);
  }

})();
