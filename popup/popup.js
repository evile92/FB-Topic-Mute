(function (global) {
  'use strict';

  const FBMute = global.FBMute || {};
  const Normalizer = FBMute.TextNormalizer;

  const DEFAULT_SETTINGS = {
    enabled: true,
    keywords: [],
    hideMode: 'collapse',
    scanImageAlt: true,
    matchType: 'partial'
  };

  let state = Object.assign({}, DEFAULT_SETTINGS);
  let activeTabId = null;
  let feedbackTimerId = null;
  let statsRefreshTimerId = null;

  // DOM References
  const appRoot = document.getElementById('appRoot');
  const masterToggle = document.getElementById('masterToggle');
  const statDot = document.getElementById('statDot');
  const statText = document.getElementById('statText');

  const addKeywordForm = document.getElementById('addKeywordForm');
  const keywordInput = document.getElementById('keywordInput');
  const feedbackBar = document.getElementById('feedbackBar');

  const keywordCount = document.getElementById('keywordCount');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const clearConfirmStrip = document.getElementById('clearConfirmStrip');
  const clearConfirmText = document.getElementById('clearConfirmText');
  const cancelClearBtn = document.getElementById('cancelClearBtn');
  const confirmClearBtn = document.getElementById('confirmClearBtn');

  const filterWrap = document.getElementById('filterWrap');
  const filterInput = document.getElementById('filterInput');
  const keywordList = document.getElementById('keywordList');
  const emptyState = document.getElementById('emptyState');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptySub = document.getElementById('emptySub');

  const modeCollapseBtn = document.getElementById('modeCollapseBtn');
  const modeHideBtn = document.getElementById('modeHideBtn');
  const matchPartialBtn = document.getElementById('matchPartialBtn');
  const matchWholeBtn = document.getElementById('matchWholeBtn');
  const scanAltToggle = document.getElementById('scanAltToggle');

  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFileInput = document.getElementById('importFileInput');

  /**
   * Show transient inline status feedback (success, error, or info).
   * @param {string} message
   * @param {'info'|'success'|'error'} [variant]
   */
  function showFeedback(message, variant) {
    if (feedbackTimerId !== null) {
      clearTimeout(feedbackTimerId);
    }
    feedbackBar.textContent = message;
    feedbackBar.className = 'feedback-bar';
    if (variant === 'success') {
      feedbackBar.classList.add('is-success');
    } else if (variant === 'error') {
      feedbackBar.classList.add('is-error');
    }
    feedbackBar.hidden = false;

    feedbackTimerId = setTimeout(function () {
      feedbackBar.hidden = true;
      feedbackTimerId = null;
    }, 3200);
  }

  /**
   * Persist partial settings patch to chrome.storage.local.
   * @param {Partial<typeof DEFAULT_SETTINGS>} patch
   * @param {() => void} [onDone]
   */
  function saveSettings(patch, onDone) {
    state = Object.assign({}, state, patch);
    chrome.storage.local.set(patch, function () {
      if (chrome.runtime.lastError) {
        showFeedback('Failed to save settings to storage.', 'error');
        return;
      }
      render();
      scheduleActiveTabStatsRefresh();
      if (typeof onDone === 'function') {
        onDone();
      }
    });
  }

  /**
   * Render live session stats indicator in the popup header.
   * @param {{ connected: boolean, count?: number, enabled?: boolean }} info
   */
  function renderSessionStats(info) {
    statDot.className = 'stat-dot';

    if (!info || !info.connected) {
      statText.textContent = 'Open or reload a Facebook tab';
      return;
    }

    if (!state.enabled) {
      statDot.classList.add('is-paused');
      statText.textContent = 'Paused on this tab';
      return;
    }

    statDot.classList.add('is-active');
    const count = typeof info.count === 'number' ? info.count : 0;
    const noun = count === 1 ? 'post' : 'posts';
    statText.textContent = count + ' ' + noun + ' muted on this page';
  }

  /**
   * Query the active tab's content script for live muted post count.
   * Works strictly with ["storage"] permission (no "tabs" permission needed).
   */
  function queryActiveTabStats() {
    if (!chrome.tabs || typeof chrome.tabs.query !== 'function') {
      renderSessionStats({ connected: false });
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (chrome.runtime.lastError || !Array.isArray(tabs) || tabs.length === 0) {
        activeTabId = null;
        renderSessionStats({ connected: false });
        return;
      }

      const tab = tabs[0];
      if (typeof tab.id !== 'number') {
        activeTabId = null;
        renderSessionStats({ connected: false });
        return;
      }

      activeTabId = tab.id;

      try {
        chrome.tabs.sendMessage(tab.id, { type: 'FB_MUTE_GET_STATS' }, function (response) {
          if (chrome.runtime.lastError || !response || !response.isFacebook) {
            renderSessionStats({ connected: false });
            return;
          }
          renderSessionStats({
            connected: true,
            count: response.count,
            enabled: response.enabled
          });
        });
      } catch (_err) {
        renderSessionStats({ connected: false });
      }
    });
  }

  /**
   * Refresh active tab stats shortly after a storage mutation so the content script has finished scanning.
   */
  function scheduleActiveTabStatsRefresh() {
    if (statsRefreshTimerId !== null) {
      clearTimeout(statsRefreshTimerId);
    }
    statsRefreshTimerId = setTimeout(function () {
      statsRefreshTimerId = null;
      queryActiveTabStats();
    }, 220);
  }

  /**
   * Create a single keyword tag <li> element with safe directional isolation (<bdi dir="auto">).
   * @param {string} keyword
   * @param {number} index
   * @returns {HTMLLIElement}
   */
  function createKeywordTagElement(keyword, index) {
    const li = document.createElement('li');
    li.className = 'keyword-tag';

    const bdi = document.createElement('bdi');
    bdi.className = 'keyword-tag-text';
    bdi.setAttribute('dir', 'auto');
    bdi.textContent = keyword;
    bdi.title = keyword;

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'keyword-delete-btn';
    delBtn.setAttribute('aria-label', 'Remove ' + keyword);
    delBtn.title = 'Remove';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const line1 = document.createElementNS(svgNS, 'line');
    line1.setAttribute('x1', '18');
    line1.setAttribute('y1', '6');
    line1.setAttribute('x2', '6');
    line1.setAttribute('y2', '18');

    const line2 = document.createElementNS(svgNS, 'line');
    line2.setAttribute('x1', '6');
    line2.setAttribute('y1', '6');
    line2.setAttribute('x2', '18');
    line2.setAttribute('y2', '18');

    svg.appendChild(line1);
    svg.appendChild(line2);
    delBtn.appendChild(svg);

    delBtn.addEventListener('click', function () {
      removeKeywordAt(index);
    });

    li.appendChild(bdi);
    li.appendChild(delBtn);
    return li;
  }

  /**
   * Render the entire popup state cleanly.
   */
  function render() {
    masterToggle.checked = Boolean(state.enabled);
    appRoot.classList.toggle('is-disabled', !state.enabled);

    // Settings controls
    modeCollapseBtn.classList.toggle('is-active', state.hideMode !== 'hide');
    modeCollapseBtn.setAttribute('aria-pressed', state.hideMode !== 'hide' ? 'true' : 'false');
    modeHideBtn.classList.toggle('is-active', state.hideMode === 'hide');
    modeHideBtn.setAttribute('aria-pressed', state.hideMode === 'hide' ? 'true' : 'false');

    matchPartialBtn.classList.toggle('is-active', state.matchType !== 'whole-word');
    matchPartialBtn.setAttribute('aria-pressed', state.matchType !== 'whole-word' ? 'true' : 'false');
    matchWholeBtn.classList.toggle('is-active', state.matchType === 'whole-word');
    matchWholeBtn.setAttribute('aria-pressed', state.matchType === 'whole-word' ? 'true' : 'false');

    scanAltToggle.checked = Boolean(state.scanImageAlt);

    // Keywords list + filtering
    const allKeywords = Array.isArray(state.keywords) ? state.keywords : [];
    const total = allKeywords.length;
    keywordCount.textContent = String(total);

    clearAllBtn.hidden = total === 0;
    filterWrap.hidden = total === 0;
    if (total === 0) {
      clearConfirmStrip.hidden = true;
      filterInput.value = '';
    }

    const queryNorm = Normalizer.normalize(filterInput.value || '');
    keywordList.textContent = '';

    const frag = document.createDocumentFragment();
    let visibleCount = 0;

    for (let i = 0; i < allKeywords.length; i++) {
      const kw = allKeywords[i];
      if (queryNorm && !Normalizer.normalize(kw).includes(queryNorm)) {
        continue;
      }
      frag.appendChild(createKeywordTagElement(kw, i));
      visibleCount++;
    }

    keywordList.appendChild(frag);

    if (total === 0) {
      emptyState.hidden = false;
      emptyTitle.textContent = 'No muted keywords yet';
      emptySub.textContent = 'Add Arabic or English words above to filter your Facebook feed.';
    } else if (visibleCount === 0) {
      emptyState.hidden = false;
      emptyTitle.textContent = 'No matching keywords';
      emptySub.textContent = 'Try a different filter term.';
    } else {
      emptyState.hidden = true;
    }
  }

  /**
   * Handle adding one or more comma-separated keywords.
   */
  function handleAddKeywords(evt) {
    evt.preventDefault();
    const rawInput = keywordInput.value || '';
    const parsed = Normalizer.parseKeywordInput(rawInput);

    if (parsed.length === 0) {
      keywordInput.focus();
      return;
    }

    const result = Normalizer.mergeUniqueKeywords(state.keywords, parsed);

    if (result.addedCount === 0) {
      showFeedback(
        parsed.length === 1 ? 'Keyword is already in your muted list.' : 'All entered keywords are already muted.',
        'info'
      );
      keywordInput.select();
      return;
    }

    keywordInput.value = '';
    clearConfirmStrip.hidden = true;

    saveSettings({ keywords: result.merged }, function () {
      if (result.skippedCount > 0) {
        showFeedback(
          'Added ' + result.addedCount + ' (' + result.skippedCount + ' duplicate skipped).',
          'success'
        );
      } else {
        showFeedback(
          result.addedCount === 1 ? 'Keyword muted.' : 'Added ' + result.addedCount + ' muted keywords.',
          'success'
        );
      }
    });
  }

  /**
   * Delete a single keyword by index.
   * @param {number} index
   */
  function removeKeywordAt(index) {
    if (index < 0 || index >= state.keywords.length) return;
    const next = state.keywords.slice();
    next.splice(index, 1);
    clearConfirmStrip.hidden = true;
    saveSettings({ keywords: next });
  }

  /**
   * Export current keywords and settings to a JSON backup file.
   */
  function handleExportJson() {
    const payload = {
      app: 'FB Topic Mute',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        enabled: state.enabled,
        hideMode: state.hideMode,
        scanImageAlt: state.scanImageAlt,
        matchType: state.matchType
      },
      keywords: state.keywords
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const dateStamp = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fb-topic-mute-backup-' + dateStamp + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    showFeedback('Backup exported (' + state.keywords.length + ' keywords).', 'success');
  }

  /**
   * Parse, validate, and safely import a JSON backup file.
   * Supports both structured backup JSON and plain string arrays.
   */
  function handleImportFileChange(evt) {
    const file = evt.target.files && evt.target.files[0];
    // Reset input so selecting the same file again still fires change
    importFileInput.value = '';
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showFeedback('File is too large (max 5 MB).', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        let incomingKeywords = null;
        const patch = {};

        if (Array.isArray(parsed)) {
          incomingKeywords = parsed;
        } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.keywords)) {
          incomingKeywords = parsed.keywords;

          if (parsed.settings && typeof parsed.settings === 'object') {
            if (typeof parsed.settings.enabled === 'boolean') {
              patch.enabled = parsed.settings.enabled;
            }
            if (parsed.settings.hideMode === 'collapse' || parsed.settings.hideMode === 'hide') {
              patch.hideMode = parsed.settings.hideMode;
            }
            if (typeof parsed.settings.scanImageAlt === 'boolean') {
              patch.scanImageAlt = parsed.settings.scanImageAlt;
            }
            if (parsed.settings.matchType === 'partial' || parsed.settings.matchType === 'whole-word') {
              patch.matchType = parsed.settings.matchType;
            }
          }
        } else {
          showFeedback('Invalid backup format. Expected a JSON array or backup file.', 'error');
          return;
        }

        const sanitized = incomingKeywords.filter(function (item) {
          return typeof item === 'string' && item.trim().length > 0;
        });

        const mergedResult = Normalizer.mergeUniqueKeywords(state.keywords, sanitized);
        patch.keywords = mergedResult.merged;

        saveSettings(patch, function () {
          if (mergedResult.addedCount > 0) {
            showFeedback(
              'Imported ' + mergedResult.addedCount + ' new keyword' + (mergedResult.addedCount === 1 ? '' : 's') + '.',
              'success'
            );
          } else {
            showFeedback('Import complete. No new keywords to add.', 'info');
          }
        });
      } catch (_err) {
        showFeedback('Could not read JSON file. Check that it is valid JSON.', 'error');
      }
    };

    reader.onerror = function () {
      showFeedback('Failed to read selected file.', 'error');
    };

    reader.readAsText(file);
  }

  /**
   * Bind all UI event listeners (zero inline handlers).
   */
  function bindEvents() {
    masterToggle.addEventListener('change', function () {
      saveSettings({ enabled: masterToggle.checked });
    });

    addKeywordForm.addEventListener('submit', handleAddKeywords);

    filterInput.addEventListener('input', function () {
      render();
    });

    clearAllBtn.addEventListener('click', function () {
      const count = state.keywords.length;
      clearConfirmText.textContent = 'Clear all ' + count + ' muted ' + (count === 1 ? 'keyword' : 'keywords') + '?';
      clearConfirmStrip.hidden = false;
      confirmClearBtn.focus();
    });

    cancelClearBtn.addEventListener('click', function () {
      clearConfirmStrip.hidden = true;
    });

    confirmClearBtn.addEventListener('click', function () {
      clearConfirmStrip.hidden = true;
      saveSettings({ keywords: [] }, function () {
        showFeedback('All muted keywords cleared.', 'info');
      });
    });

    modeCollapseBtn.addEventListener('click', function () {
      if (state.hideMode !== 'collapse') {
        saveSettings({ hideMode: 'collapse' });
      }
    });

    modeHideBtn.addEventListener('click', function () {
      if (state.hideMode !== 'hide') {
        saveSettings({ hideMode: 'hide' });
      }
    });

    matchPartialBtn.addEventListener('click', function () {
      if (state.matchType !== 'partial') {
        saveSettings({ matchType: 'partial' });
      }
    });

    matchWholeBtn.addEventListener('click', function () {
      if (state.matchType !== 'whole-word') {
        saveSettings({ matchType: 'whole-word' });
      }
    });

    scanAltToggle.addEventListener('change', function () {
      saveSettings({ scanImageAlt: scanAltToggle.checked });
    });

    exportBtn.addEventListener('click', handleExportJson);

    importBtn.addEventListener('click', function () {
      importFileInput.click();
    });

    importFileInput.addEventListener('change', handleImportFileChange);

    // Live updates pushed from the active Facebook tab's content script
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (message, sender) {
        if (!message || message.type !== 'FB_MUTE_STATS_UPDATED') return;
        if (activeTabId !== null && sender && sender.tab && sender.tab.id !== activeTabId) {
          return;
        }
        renderSessionStats({
          connected: true,
          count: message.count,
          enabled: message.enabled
        });
      });
    }
  }

  /**
   * Initialize popup state from chrome.storage.local.
   */
  function init() {
    bindEvents();

    chrome.storage.local.get(DEFAULT_SETTINGS, function (stored) {
      if (!chrome.runtime.lastError && stored) {
        state = {
          enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
          keywords: Array.isArray(stored.keywords) ? stored.keywords : [],
          hideMode: stored.hideMode === 'hide' ? 'hide' : 'collapse',
          scanImageAlt: typeof stored.scanImageAlt === 'boolean' ? stored.scanImageAlt : DEFAULT_SETTINGS.scanImageAlt,
          matchType: stored.matchType === 'whole-word' ? 'whole-word' : 'partial'
        };
      }
      render();
      queryActiveTabStats();
    });
  }

  init();
})(window);
