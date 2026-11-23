(function (global) {
  'use strict';

  const FBMute = (global.FBMute = global.FBMute || {});

  /**
   * Centralized semantic & structural DOM selectors for Facebook.
   * Zero obfuscated/auto-generated CSS class names.
   */
  const SELECTORS = {
    MAIN_CONTAINER: '[role="main"]',
    FEED_CONTAINER: '[role="feed"]',
    FEED_UNIT_PAGELET: '[data-pagelet^="FeedUnit"]',
    FEED_UNIT_POSINSET: '[aria-posinset]',
    ARTICLE: '[role="article"]',
    POST_MESSAGE:
      '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-ad-rendering-role="story_message"]',
    TEXT_BLOCKS:
      '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-ad-rendering-role="story_message"], [data-ad-rendering-role="title"], [data-ad-rendering-role="description"], [data-ad-rendering-role="meta"], blockquote, [dir="auto"], h2, h3, h4',
    REEL_TEXT_BLOCKS: '[dir="auto"], h2, h3, h4',
    REEL_LINK: 'a[href*="/reel/"]',
    IMAGE_WITH_ALT: 'img[alt]',
    STORIES_CONTAINER: '[data-pagelet="Stories"], [aria-label="Stories"], [aria-label="القصص"]',
    DIALOG_ANCESTOR: '[role="dialog"], [role="alertdialog"]',
    NON_FEED_ANCESTOR:
      '[role="dialog"], [role="alertdialog"], [role="navigation"], [role="complementary"], [role="banner"], [role="menu"], [role="listbox"], [role="tablist"]',
    EXCLUDED_CHROME_ANCESTOR:
      '[data-fb-mute-bar="true"], form, [role="textbox"], [contenteditable="true"], [role="toolbar"], [role="menubar"], [role="menu"], [role="listbox"], [role="tooltip"], button, [role="button"]'
  };

  const REEL_ID_RE = /\/reel\/([^/?#&]+)/i;
  const COMMENT_ARIA_RE = /\b(comment|reply|comments|replies)\b|تعليق|رد/i;
  const STATIC_EMOJI_OR_ICON_SRC_RE = /\/(emoji\.php|rsrc\.php)\/|images\/emoji/i;
  const GENERIC_ALT_RE =
    /^(no photo description available\.?|image|photo|profile picture|avatar|صورة شخصية|لا يتوفر وصف للصورة\.?)$/i;
  const EXCLUDED_POSINSET_ROLES = new Set([
    'option',
    'menuitem',
    'menuitemradio',
    'menuitemcheckbox',
    'tab',
    'treeitem',
    'row',
    'gridcell'
  ]);

  const MIN_CONTENT_IMAGE_PX = 64;

  /**
   * Determine if an element sits inside a comment/reply subtree of a post container.
   * Ensures comments never trigger hiding an unrelated parent post.
   * @param {Element} node
   * @param {Element} postRoot
   * @param {Element|null} primaryArticle
   * @returns {boolean}
   */
  function isInsideCommentSubtree(node, postRoot, primaryArticle) {
    let cur = node;
    while (cur && cur !== postRoot) {
      if (cur === primaryArticle) {
        return false;
      }

      if (cur.nodeType === 1) {
        if (cur.hasAttribute('data-fb-mute-bar')) {
          return true;
        }

        const tag = cur.tagName;
        if (tag === 'FORM') {
          return true;
        }

        const role = cur.getAttribute('role');
        if (role === 'textbox' || cur.getAttribute('contenteditable') === 'true') {
          return true;
        }

        // Comment threads inside a post are often wrapped in <ul> containing nested [role="article"]
        if (tag === 'UL' && cur.querySelector(SELECTORS.ARTICLE)) {
          return true;
        }

        // Any nested [role="article"] inside a post's primary [role="article"] is a comment/reply in FB's DOM
        if (role === 'article') {
          if (primaryArticle && primaryArticle.contains(cur) && cur !== primaryArticle) {
            return true;
          }
          const ariaLabel = cur.getAttribute('aria-label') || '';
          if (COMMENT_ARIA_RE.test(ariaLabel)) {
            return true;
          }
        }
      }

      cur = cur.parentElement;
    }
    return false;
  }

  /**
   * Check whether a candidate element is actually a comment article rather than a feed post.
   * @param {Element} el
   * @returns {boolean}
   */
  function isStandaloneCommentElement(el) {
    if (el.closest('ul, li, form')) {
      return true;
    }
    const ariaLabel = el.getAttribute('aria-label') || '';
    if (COMMENT_ARIA_RE.test(ariaLabel)) {
      return true;
    }
    // Nested inside another article
    const parentArticle = el.parentElement ? el.parentElement.closest(SELECTORS.ARTICLE) : null;
    if (parentArticle) {
      return true;
    }
    return false;
  }

  /**
   * Check whether an element is inside non-feed UI chrome (navbars, dialogs, stories, chat).
   * @param {Element} el
   * @returns {boolean}
   */
  function isOutsideFeedArea(el) {
    return Boolean(el.closest(SELECTORS.NON_FEED_ANCESTOR) || el.closest(SELECTORS.STORIES_CONTAINER));
  }

  /**
   * Detect if a feed unit is a horizontal Reels shelf containing 2+ distinct Reel cards.
   * If so, returns the individual card container elements so only matching cards are hidden.
   * @param {Element} unitEl
   * @returns {Element[]|null}
   */
  function extractReelCards(unitEl) {
    const anchors = unitEl.querySelectorAll(SELECTORS.REEL_LINK);
    if (anchors.length < 2) {
      return null;
    }

    const reelMap = new Map();
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (a.closest('[data-fb-mute-bar="true"]')) continue;
      const href = a.getAttribute('href') || '';
      const match = href.match(REEL_ID_RE);
      if (!match) continue;
      const reelId = match[1];
      if (!reelMap.has(reelId)) {
        reelMap.set(reelId, []);
      }
      reelMap.get(reelId).push(a);
    }

    // Need at least 2 distinct Reels to qualify as a multi-card Reels shelf
    if (reelMap.size < 2) {
      return null;
    }

    const cards = [];
    const cardSet = new Set();

    reelMap.forEach(function (reelAnchors, reelId) {
      let current = reelAnchors[0];
      while (current && current.parentElement && current.parentElement !== unitEl) {
        const parent = current.parentElement;
        // Stop climbing as soon as parent contains a link to a DIFFERENT Reel ID
        const parentReelLinks = parent.querySelectorAll(SELECTORS.REEL_LINK);
        let containsOtherReel = false;
        for (let j = 0; j < parentReelLinks.length; j++) {
          const otherHref = parentReelLinks[j].getAttribute('href') || '';
          const otherMatch = otherHref.match(REEL_ID_RE);
          if (otherMatch && otherMatch[1] !== reelId) {
            containsOtherReel = true;
            break;
          }
        }
        if (containsOtherReel) {
          break;
        }
        current = parent;
      }

      if (current && current !== unitEl && !cardSet.has(current)) {
        cardSet.add(current);
        cards.push(current);
      }
    });

    if (cards.length < 2) {
      return null;
    }

    // Safety check: ensure no selected card contains another selected card
    return cards.filter(function (candidate) {
      for (let i = 0; i < cards.length; i++) {
        if (cards[i] !== candidate && cards[i].contains(candidate)) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Collect all scannable targets (posts & isolated Reel cards) on the current Facebook view.
   * @param {Document|Element} [root]
   * @returns {{ targets: Array<{ element: Element, kind: 'post'|'reel-card' }>, reelsShelfUnits: Element[] }}
   */
  function findScanTargets(root) {
    const docRoot = root || document;
    const scope =
      (docRoot.querySelector && docRoot.querySelector(SELECTORS.MAIN_CONTAINER)) ||
      (docRoot === document ? document.body : docRoot);

    if (!scope || !scope.querySelectorAll) {
      return { targets: [], reelsShelfUnits: [] };
    }

    const rawCandidates = [];
    const seen = new Set();

    function addCandidate(el) {
      if (!el || seen.has(el)) return;
      if (isOutsideFeedArea(el)) return;
      seen.add(el);
      rawCandidates.push(el);
    }

    // Priority 1: Explicit FeedUnit pagelets
    const pagelets = scope.querySelectorAll(SELECTORS.FEED_UNIT_PAGELET);
    for (let i = 0; i < pagelets.length; i++) {
      addCandidate(pagelets[i]);
    }

    // Priority 2: Semantic aria-posinset feed items (modern FB Home/Groups/Search often omit role="feed" and role="article")
    const posinsetNodes = scope.querySelectorAll(SELECTORS.FEED_UNIT_POSINSET);
    for (let i = 0; i < posinsetNodes.length; i++) {
      const node = posinsetNodes[i];
      const role = node.getAttribute('role') || '';
      if (EXCLUDED_POSINSET_ROLES.has(role)) continue;
      if (node.closest('ul, li, form')) continue;
      if (COMMENT_ARIA_RE.test(node.getAttribute('aria-label') || '')) continue;
      addCandidate(node);
    }

    // Priority 3: Top-level [role="article"] posts (Groups, Watch, Profile, Search fallback)
    const articles = scope.querySelectorAll(SELECTORS.ARTICLE);
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      if (!isStandaloneCommentElement(article)) {
        addCandidate(article);
      }
    }

    // Remove nested candidates so each feed unit is represented once by its outermost post container
    const topLevelUnits = rawCandidates.filter(function (candidate) {
      for (let i = 0; i < rawCandidates.length; i++) {
        const other = rawCandidates[i];
        if (other !== candidate && other.contains(candidate)) {
          return false;
        }
      }
      return true;
    });

    const targets = [];
    const reelsShelfUnits = [];

    for (let i = 0; i < topLevelUnits.length; i++) {
      const unit = topLevelUnits[i];
      const reelCards = extractReelCards(unit);
      if (reelCards && reelCards.length >= 2) {
        reelsShelfUnits.push(unit);
        for (let r = 0; r < reelCards.length; r++) {
          targets.push({ element: reelCards[r], kind: 'reel-card' });
        }
      } else {
        targets.push({ element: unit, kind: 'post' });
      }
    }

    return { targets, reelsShelfUnits };
  }

  /**
   * Determine if an <img> is a small avatar, reaction icon, or static emoji image.
   * @param {HTMLImageElement} img
   * @returns {boolean}
   */
  function isSmallIconOrAvatar(img) {
    const src = img.getAttribute('src') || '';
    if (STATIC_EMOJI_OR_ICON_SRC_RE.test(src)) {
      return true;
    }

    if (img.getAttribute('aria-hidden') === 'true') {
      return true;
    }

    // Check intrinsic loaded dimensions
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      if (img.naturalWidth < MIN_CONTENT_IMAGE_PX && img.naturalHeight < MIN_CONTENT_IMAGE_PX) {
        return true;
      }
    }

    // Check rendered box dimensions (avatars are typically 32x32, 36x36, 40x40; icons 16x16 - 24x24)
    if (typeof img.getBoundingClientRect === 'function') {
      const rect = img.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.width < MIN_CONTENT_IMAGE_PX && rect.height < MIN_CONTENT_IMAGE_PX) {
        return true;
      }
    }

    // Check explicit HTML width/height attributes before image layout completes
    const attrW = parseInt(img.getAttribute('width') || '0', 10);
    const attrH = parseInt(img.getAttribute('height') || '0', 10);
    if (attrW > 0 && attrH > 0 && attrW < MIN_CONTENT_IMAGE_PX && attrH < MIN_CONTENT_IMAGE_PX) {
      return true;
    }

    return false;
  }

  /**
   * Extract clean post text (main body, shared/quoted text, link previews, optional image alt)
   * while strictly isolating out comment sections, reply threads, and FB chrome buttons.
   * @param {Element} targetEl
   * @param {{ scanImageAlt: boolean, kind: 'post'|'reel-card' }} options
   * @returns {string}
   */
  function extractTargetText(targetEl, options) {
    const parts = [];
    const scanImageAlt = Boolean(options && options.scanImageAlt);
    const isReelCard = options && options.kind === 'reel-card';

    let primaryArticle = null;
    if (targetEl.matches(SELECTORS.ARTICLE)) {
      primaryArticle = targetEl;
    } else {
      const articlesInside = targetEl.querySelectorAll(SELECTORS.ARTICLE);
      for (let i = 0; i < articlesInside.length; i++) {
        const candidate = articlesInside[i];
        if (
          !candidate.closest('ul, li, form') &&
          !COMMENT_ARIA_RE.test(candidate.getAttribute('aria-label') || '')
        ) {
          primaryArticle = candidate;
          break;
        }
      }
    }

    const textSelector = isReelCard ? SELECTORS.REEL_TEXT_BLOCKS : SELECTORS.TEXT_BLOCKS;
    const textNodes = targetEl.querySelectorAll(textSelector);
    const acceptedContainers = [];

    for (let i = 0; i < textNodes.length; i++) {
      const el = textNodes[i];

      // Skip if already covered by an accepted ancestor container
      let coveredByAncestor = false;
      for (let a = 0; a < acceptedContainers.length; a++) {
        if (acceptedContainers[a].contains(el)) {
          coveredByAncestor = true;
          break;
        }
      }
      if (coveredByAncestor) continue;

      if (el.closest('[data-fb-mute-bar="true"]')) continue;
      if (!isReelCard && isInsideCommentSubtree(el, targetEl, primaryArticle)) continue;

      // Exclude UI action buttons ("Like", "Comment", "Share", "Follow") so muting common words doesn't hide all posts
      const isExplicitPostMessage = el.matches(SELECTORS.POST_MESSAGE);
      if (!isExplicitPostMessage && !isReelCard) {
        const chromeAncestor = el.closest(SELECTORS.EXCLUDED_CHROME_ANCESTOR);
        if (chromeAncestor && targetEl.contains(chromeAncestor)) {
          continue;
        }
      }

      const rawText = (el.textContent || '').trim();
      if (rawText) {
        acceptedContainers.push(el);
        parts.push(rawText);
      }
    }

    // For Reel cards, captions/titles are sometimes stored on the reel link's aria-label
    if (isReelCard) {
      const reelLinks = targetEl.matches(SELECTORS.REEL_LINK)
        ? [targetEl]
        : targetEl.querySelectorAll(SELECTORS.REEL_LINK);
      for (let i = 0; i < reelLinks.length; i++) {
        const label = (reelLinks[i].getAttribute('aria-label') || '').trim();
        if (label) {
          parts.push(label);
        }
      }
    }

    // Optional image alt text extraction (excluding small avatars, icons, and emojis)
    if (scanImageAlt) {
      const images = targetEl.querySelectorAll(SELECTORS.IMAGE_WITH_ALT);
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.closest('[data-fb-mute-bar="true"]')) continue;
        if (!isReelCard && isInsideCommentSubtree(img, targetEl, primaryArticle)) continue;
        if (isSmallIconOrAvatar(img)) continue;

        const alt = (img.getAttribute('alt') || '').trim();
        if (alt.length >= 3 && !GENERIC_ALT_RE.test(alt)) {
          parts.push(alt);
        }
      }
    }

    return parts.join(' ');
  }

  FBMute.Selectors = {
    SELECTORS,
    isInsideCommentSubtree,
    isStandaloneCommentElement,
    isSmallIconOrAvatar,
    extractReelCards,
    findScanTargets,
    extractTargetText
  };
})(window);
