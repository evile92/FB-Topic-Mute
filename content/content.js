(function (global) {
  'use strict';

  // Prevent duplicate initialization if script is ever evaluated more than once
  if (global.__FB_TOPIC_MUTE_INIT__) {
    return;
  }
  global.__FB_TOPIC_MUTE_INIT__ = true;

  const FBMute = (global.FBMute = global.FBMute || {});
  const Normalizer = FBMute.TextNormalizer;
  const Selectors = FBMute.Selectors;

  if (!Normalizer || !Selectors) {
    return;
  }

  const DEFAULT_SETTINGS = {
    enabled: true,
    keywords: [],
    hideMode: 'collapse', // 'collapse' | 'hide'
    scanImageAlt: true,
    matchType: 'partial'  // 'partial' | 'whole-word'
  };

  const SCAN_DEBOUNCE_MS = 150;

  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let matcher = Normalizer.compileMatcher([], settings.matchType);
  let configVersion = 1;

  // WeakMap cache: Element -> { signature: string, configVersion: number, matched: { raw, normalized } | null }
  const scanCache = new WeakMap();

  // WeakMap tracking posts the user explicitly clicked "Show" on: Element -> matchedNormalizedKeyword
  const manuallyRevealed = new WeakMap();

  // Track elements currently styled/controlled by FB Topic Mute
  const managedElements = new Set();

  // Track elements currently actively hidden/collapsed for accurate live session stats
  const mutedElements = new Set();

  let lastReportedMutedCount = -1;
  let lastUrl = global.location ? global.location.href : '';

  let debounceTimerId = null;
  let rafId = null;
  let spaFollowupTimerId = null;
  let observer = null;

  /**
   * Create our slim Collapse / Reveal bar element (zero inline event handlers).
   * @param {string} matchedRawKeyword
   * @param {boolean} isRevealed
   * @param {Element} targetEl
   * @returns {HTMLDivElement}
   */
  function createMuteBar(matchedRawKeyword, isRevealed, targetEl) {
    const bar = document.createElement('div');
    bar.className = 'fb-mute-bar';
    bar.setAttribute('data-fb-mute-bar', 'true');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Muted post notice');

    const info = document.createElement('div');
    info.className = 'fb-mute-bar-info';

    // Crisp inline SVG mute icon (no external assets)
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'fb-mute-bar-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const poly = document.createElementNS(svgNS, 'polygon');
    poly.setAttribute('points', '11 5 6 9 2 9 2 15 6 15 11 19 11 5');
    const line1 = document.createElementNS(svgNS, 'line');
    line1.setAttribute('x1', '23');
    line1.setAttribute('y1', '9');
    line1.setAttribute('x2', '17');
    line1.setAttribute('y2', '15');
    const line2 = document.createElementNS(svgNS, 'line');
    line2.setAttribute('x1', '17');
    line2.setAttribute('y1', '9');
    line2.setAttribute('x2', '23');
    line2.setAttribute('y2', '15');

    svg.appendChild(poly);
    svg.appendChild(line1);
    svg.appendChild(line2);

    const label = document.createElement('span');
    label.className = 'fb-mute-bar-label';
    label.textContent = 'Muted:';

    const keywordPill = document.createElement('bdi');
    keywordPill.className = 'fb-mute-bar-keyword';
    keywordPill.setAttribute('dir', 'auto');
    keywordPill.textContent = matchedRawKeyword;
    keywordPill.title = matchedRawKeyword;

    info.appendChild(svg);
    info.appendChild(label);
    info.appendChild(keywordPill);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'fb-mute-bar-btn';
    toggleBtn.textContent = isRevealed ? 'Hide' : 'Show';
    toggleBtn.setAttribute('aria-expanded', isRevealed ? 'true' : 'false');

    toggleBtn.addEventListener('click', function (evt) {
      evt.preventDefault();
      evt.stopPropagation();
      toggleRevealState(targetEl);
    });

    bar.appendChild(info);
    bar.appendChild(toggleBtn);
    return bar;
  }

  /**
   * Find an existing direct-child mute bar on a target element.
   * @param {Element} targetEl
   * @returns {Element|null}
   */
  function getDirectMuteBar(targetEl) {
    const children = targetEl.children;
    for (let i = 0; i < children.length; i++) {
      if (children[i].getAttribute('data-fb-mute-bar') === 'true') {
        return children[i];
      }
    }
    return null;
  }

  /**
   * Remove only our own injected bar (never touches Facebook/React nodes).
   * @param {Element} targetEl
   */
  function removeOwnMuteBar(targetEl) {
    const bar = getDirectMuteBar(targetEl);
    if (bar && bar.parentNode === targetEl) {
      targetEl.removeChild(bar);
    }
  }

  /**
   * Ensure the collapse bar exists and displays the up-to-date keyword & button state.
   * @param {Element} targetEl
   * @param {string} matchedRawKeyword
   * @param {boolean} isRevealed
   */
  function ensureMuteBar(targetEl, matchedRawKeyword, isRevealed) {
    let bar = getDirectMuteBar(targetEl);
    if (!bar) {
      bar = createMuteBar(matchedRawKeyword, isRevealed, targetEl);
      targetEl.insertBefore(bar, targetEl.firstChild);
      return;
    }

    const keywordPill = bar.querySelector('.fb-mute-bar-keyword');
    if (keywordPill && keywordPill.textContent !== matchedRawKeyword) {
      keywordPill.textContent = matchedRawKeyword;
      keywordPill.title = matchedRawKeyword;
    }

    const toggleBtn = bar.querySelector('.fb-mute-bar-btn');
    const desiredLabel = isRevealed ? 'Hide' : 'Show';
    if (toggleBtn && toggleBtn.textContent !== desiredLabel) {
      toggleBtn.textContent = desiredLabel;
      toggleBtn.setAttribute('aria-expanded', isRevealed ? 'true' : 'false');
    }
  }

  /**
   * Toggle between collapsed and revealed state when the user clicks "Show" / "Hide".
   * @param {Element} targetEl
   */
  function toggleRevealState(targetEl) {
    if (!targetEl || !targetEl.isConnected) return;

    const currentState = targetEl.getAttribute('data-fb-mute-state');
    const cached = scanCache.get(targetEl);
    const matched = cached && cached.matched ? cached.matched : null;
    const rawKeyword = matched
      ? matched.raw
      : targetEl.getAttribute('data-fb-mute-keyword') || '';

    if (currentState === 'collapsed') {
      targetEl.setAttribute('data-fb-mute-state', 'revealed');
      if (matched) {
        manuallyRevealed.set(targetEl, matched.normalized);
      }
      mutedElements.delete(targetEl);
      ensureMuteBar(targetEl, rawKeyword, true);
    } else if (currentState === 'revealed') {
      targetEl.setAttribute('data-fb-mute-state', 'collapsed');
      manuallyRevealed.delete(targetEl);
      mutedElements.add(targetEl);
      ensureMuteBar(targetEl, rawKeyword, false);
    }

    notifyStatsIfChanged();
  }

  /**
   * Restore a target element back to its untouched visual state.
   * @param {Element} targetEl
   */
  function restoreElement(targetEl) {
    if (!targetEl) return;
    if (targetEl.hasAttribute('data-fb-mute-state')) {
      targetEl.removeAttribute('data-fb-mute-state');
    }
    if (targetEl.hasAttribute('data-fb-mute-kind')) {
      targetEl.removeAttribute('data-fb-mute-kind');
    }
    if (targetEl.hasAttribute('data-fb-mute-keyword')) {
      targetEl.removeAttribute('data-fb-mute-keyword');
    }
    removeOwnMuteBar(targetEl);
    manuallyRevealed.delete(targetEl);
    mutedElements.delete(targetEl);
    managedElements.delete(targetEl);
  }

  /**
   * Apply the active hide mode ('collapse' or 'hide') to a matched element.
   * @param {Element} targetEl
   * @param {'post'|'reel-card'} kind
   * @param {{ raw: string, normalized: string }} matched
   */
  function applyMuteState(targetEl, kind, matched) {
    managedElements.add(targetEl);
    targetEl.setAttribute('data-fb-mute-kind', kind);
    targetEl.setAttribute('data-fb-mute-keyword', matched.raw);

    if (settings.hideMode === 'hide') {
      removeOwnMuteBar(targetEl);
      manuallyRevealed.delete(targetEl);
      targetEl.setAttribute('data-fb-mute-state', 'hidden');
      mutedElements.add(targetEl);
      return;
    }

    // Collapse Mode (default)
    const revealedForKeyword = manuallyRevealed.get(targetEl);
    if (revealedForKeyword && revealedForKeyword === matched.normalized) {
      targetEl.setAttribute('data-fb-mute-state', 'revealed');
      mutedElements.delete(targetEl);
      ensureMuteBar(targetEl, matched.raw, true);
    } else {
      targetEl.setAttribute('data-fb-mute-state', 'collapsed');
      mutedElements.add(targetEl);
      ensureMuteBar(targetEl, matched.raw, false);
    }
  }

  /**
   * Remove disconnected DOM references so live session stats never drift on SPA virtualization.
   */
  function pruneDisconnectedElements() {
    mutedElements.forEach(function (el) {
      if (!el.isConnected) {
        mutedElements.delete(el);
      }
    });
    managedElements.forEach(function (el) {
      if (!el.isConnected) {
        managedElements.delete(el);
      }
    });
  }

  /**
   * Restore every currently managed element (used when extension is disabled or keywords cleared).
   */
  function restoreAllManaged() {
    const snapshot = Array.from(managedElements);
    for (let i = 0; i < snapshot.length; i++) {
      restoreElement(snapshot[i]);
    }
    mutedElements.clear();
    managedElements.clear();
  }

  /**
   * Evaluate a single feed post or Reel card with WeakMap text-signature caching.
   * @param {{ element: Element, kind: 'post'|'reel-card' }} target
   */
  function processTarget(target) {
    const el = target.element;
    const kind = target.kind;

    const rawText = Selectors.extractTargetText(el, {
      scanImageAlt: settings.scanImageAlt,
      kind: kind
    });
    const signature = Normalizer.computeSignature(rawText);
    const cached = scanCache.get(el);

    if (cached && cached.configVersion === configVersion && cached.signature === signature) {
      // Nothing changed; if collapsed/revealed in collapse mode, ensure React didn't wipe our bar
      if (cached.matched && settings.hideMode === 'collapse') {
        const state = el.getAttribute('data-fb-mute-state');
        if (state === 'collapsed' || state === 'revealed') {
          ensureMuteBar(el, cached.matched.raw, state === 'revealed');
        }
      }
      return;
    }

    const normalizedText = Normalizer.normalize(rawText);
    const matched = matcher.findMatch(normalizedText);

    scanCache.set(el, {
      signature: signature,
      configVersion: configVersion,
      matched: matched
    });

    if (matched) {
      applyMuteState(el, kind, matched);
    } else if (managedElements.has(el) || el.hasAttribute('data-fb-mute-state')) {
      restoreElement(el);
    }
  }

  /**
   * Run a full pass across active Facebook feed targets.
   */
  function runScan() {
    rafId = null;

    if (!settings.enabled || !matcher.hasKeywords) {
      restoreAllManaged();
      notifyStatsIfChanged();
      return;
    }

    pruneDisconnectedElements();

    const result = Selectors.findScanTargets(document);

    // If a feed unit hydrated into a multi-card Reels shelf, ensure the outer shelf wrapper itself isn't muted
    for (let s = 0; s < result.reelsShelfUnits.length; s++) {
      const shelfUnit = result.reelsShelfUnits[s];
      if (managedElements.has(shelfUnit) || shelfUnit.hasAttribute('data-fb-mute-state')) {
        restoreElement(shelfUnit);
      }
    }

    for (let i = 0; i < result.targets.length; i++) {
      processTarget(result.targets[i]);
    }

    pruneDisconnectedElements();
    notifyStatsIfChanged();
  }

  /**
   * Schedule a batched scan via debounce + requestAnimationFrame to stay at 60 FPS during fast scroll.
   * @param {boolean} [immediate]
   */
  function scheduleScan(immediate) {
    if (immediate) {
      if (debounceTimerId !== null) {
        clearTimeout(debounceTimerId);
        debounceTimerId = null;
      }
      if (rafId === null) {
        rafId = global.requestAnimationFrame(runScan);
      }
      return;
    }

    if (debounceTimerId !== null) {
      return;
    }

    debounceTimerId = global.setTimeout(function () {
      debounceTimerId = null;
      if (rafId === null) {
        rafId = global.requestAnimationFrame(runScan);
      }
    }, SCAN_DEBOUNCE_MS);
  }

  /**
   * Push live muted-post count to the popup if open (safely ignoring closed-popup errors).
   */
  function notifyStatsIfChanged() {
    const count = mutedElements.size;
    if (count === lastReportedMutedCount) {
      return;
    }
    lastReportedMutedCount = count;

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage(
          { type: 'FB_MUTE_STATS_UPDATED', count: count, enabled: settings.enabled },
          function () {
            // Consume lastError silently when popup is closed
            void chrome.runtime.lastError;
          }
        );
      } catch (_err) {
        // Extension context invalidated after reload; ignore gracefully
      }
    }
  }

  /**
   * Handle Facebook SPA navigation transitions (Home, Groups, Watch, Search, Profiles).
   */
  function handlePotentialRouteChange() {
    const currentUrl = global.location ? global.location.href : '';
    if (currentUrl === lastUrl) {
      return;
    }
    lastUrl = currentUrl;
    pruneDisconnectedElements();
    scheduleScan(true);

    // Follow-up scan after async feed hydration settles
    if (spaFollowupTimerId !== null) {
      clearTimeout(spaFollowupTimerId);
    }
    spaFollowupTimerId = global.setTimeout(function () {
      spaFollowupTimerId = null;
      scheduleScan(true);
    }, 450);
  }

  /**
   * Check whether a MutationRecord belongs solely to our own injected bar (prevents feedback loops).
   * @param {MutationRecord} mutation
   * @returns {boolean}
   */
  function isOwnMutation(mutation) {
    const target = mutation.target;
    if (target && target.nodeType === 1 && target.closest('[data-fb-mute-bar="true"]')) {
      return true;
    }
    if (target && target.nodeType === 3 && target.parentElement && target.parentElement.closest('[data-fb-mute-bar="true"]')) {
      return true;
    }

    if (mutation.type === 'childList') {
      const added = mutation.addedNodes;
      const removed = mutation.removedNodes;
      let hasNonBarNode = false;
      for (let i = 0; i < added.length; i++) {
        const n = added[i];
        if (n.nodeType !== 1 || n.getAttribute('data-fb-mute-bar') !== 'true') {
          hasNonBarNode = true;
          break;
        }
      }
      if (!hasNonBarNode) {
        for (let i = 0; i < removed.length; i++) {
          const n = removed[i];
          if (n.nodeType !== 1 || n.getAttribute('data-fb-mute-bar') !== 'true') {
            hasNonBarNode = true;
            break;
          }
        }
      }
      if (!hasNonBarNode) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check whether a mutation touches the main content area or could introduce a new main/feed region.
   * Filters out unrelated Messenger chat/navbar churn for maximum scroll performance.
   * @param {MutationRecord} mutation
   * @returns {boolean}
   */
  function isRelevantMutation(mutation) {
    if (isOwnMutation(mutation)) {
      return false;
    }

    const target = mutation.target;
    const el = target && target.nodeType === 1 ? target : target ? target.parentElement : null;
    if (!el) return false;

    if (el.closest(Selectors.SELECTORS.MAIN_CONTAINER)) {
      return true;
    }

    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i];
        if (
          node.nodeType === 1 &&
          (node.matches(Selectors.SELECTORS.MAIN_CONTAINER) ||
            node.matches(Selectors.SELECTORS.FEED_CONTAINER) ||
            (node.querySelector && node.querySelector(Selectors.SELECTORS.MAIN_CONTAINER)))
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Start the single MutationObserver on document.body.
   */
  function startObserver() {
    if (observer) return;
    const root = document.body || document.documentElement;
    if (!root) return;

    observer = new MutationObserver(function (mutations) {
      handlePotentialRouteChange();

      if (!settings.enabled || !matcher.hasKeywords) {
        return;
      }

      for (let i = 0; i < mutations.length; i++) {
        if (isRelevantMutation(mutations[i])) {
          scheduleScan(false);
          return;
        }
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  /**
   * Apply new settings object, recompile matcher, and trigger immediate rescan.
   * @param {Partial<typeof DEFAULT_SETTINGS>} incoming
   */
  function applySettings(incoming) {
    const next = Object.assign({}, DEFAULT_SETTINGS, settings, incoming);
    next.enabled = typeof next.enabled === 'boolean' ? next.enabled : DEFAULT_SETTINGS.enabled;
    next.keywords = Array.isArray(next.keywords) ? next.keywords : [];
    next.hideMode = next.hideMode === 'hide' ? 'hide' : 'collapse';
    next.scanImageAlt = typeof next.scanImageAlt === 'boolean' ? next.scanImageAlt : DEFAULT_SETTINGS.scanImageAlt;
    next.matchType = next.matchType === 'whole-word' ? 'whole-word' : 'partial';

    settings = next;
    matcher = Normalizer.compileMatcher(settings.keywords, settings.matchType);
    configVersion += 1;

    scheduleScan(true);
  }

  /**
   * Load persisted settings from chrome.storage.local and begin observing.
   */
  function init() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return;
    }

    chrome.storage.local.get(DEFAULT_SETTINGS, function (stored) {
      if (chrome.runtime.lastError) {
        return;
      }
      applySettings(stored || DEFAULT_SETTINGS);
      startObserver();
    });

    // Real-time reactivity across all open Facebook tabs without refreshing
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== 'local') return;

      const patch = {};
      let relevant = false;
      const keys = ['enabled', 'keywords', 'hideMode', 'scanImageAlt', 'matchType'];
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (Object.prototype.hasOwnProperty.call(changes, key)) {
          patch[key] = changes[key].newValue;
          relevant = true;
        }
      }

      if (relevant) {
        applySettings(patch);
      }
    });

    // Respond to popup live-stat requests
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
        if (!message || typeof message !== 'object') return;

        if (message.type === 'FB_MUTE_GET_STATS') {
          pruneDisconnectedElements();
          sendResponse({
            isFacebook: true,
            enabled: settings.enabled,
            count: mutedElements.size
          });
        }
      });
    }

    // SPA navigation listeners (popstate, hashchange, and modern Navigation API when supported)
    global.addEventListener('popstate', handlePotentialRouteChange);
    global.addEventListener('hashchange', handlePotentialRouteChange);
    if (global.navigation && typeof global.navigation.addEventListener === 'function') {
      global.navigation.addEventListener('navigatesuccess', handlePotentialRouteChange);
    }
  }

  init();
})(window);
