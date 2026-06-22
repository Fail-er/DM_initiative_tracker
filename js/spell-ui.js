/**
 * spell-ui.js
 * -----------------------------------------------------------------------
 * Header Spellbook search (bullets A-C, J): a search input next to the
 * app title, a floating results overlay beneath it, and a floating spell
 * card for the selected result. Entirely independent of the encounter --
 * spells are never inserted anywhere, this is read-only reference only.
 *
 * Deliberately a separate module from ui.js: the spellbook has no
 * interaction with monsters/players/encounter state at all, so keeping
 * it isolated means ui.js doesn't grow for a feature that's conceptually
 * unrelated to combat tracking.
 * -----------------------------------------------------------------------
 */

const SpellUI = (() => {
  const MIN_QUERY_LENGTH = 3;

  let el = {};
  let activeResults = []; // current overlay result list, for arrow-key navigation
  let highlightedIndex = -1; // -1 = nothing highlighted
  let cardPinned = false;
  let cardOpenForId = null;

  function cacheRefs() {
    el = {
      searchInput: document.getElementById('spellbook-search-input'),
      results: document.getElementById('spellbook-results'),
      importBtn: document.getElementById('spellbook-import-btn'),
      importInput: document.getElementById('spellbook-import-input'),

      card: document.getElementById('spell-card'),
      cardTitle: document.getElementById('spell-card-title'),
      cardBody: document.getElementById('spell-card-body'),
      cardCloseBtn: document.getElementById('spell-card-close-btn'),
      cardPinBtn: document.getElementById('spell-card-pin-btn'),
    };
  }

  // -------------------------------------------------------------------
  // Search overlay (bullet B)
  // -------------------------------------------------------------------

  /** Builds the compact one-line summary shown per result, matching the
   *  style from the spec: "Lv 3 · Evocation · 1 action · 150 ft. · DEX
   *  save · fire". Only includes parts that are actually present --
   *  a buff spell with no save/damage just shows fewer segments,
   *  rather than empty placeholders.
   *
   *  Uses a SHORTENED casting time (e.g. "1 reaction", dropping any
   *  parenthetical trigger condition like "(which you take when...)")
   *  since that detail makes a one-line result row unreadable. The full
   *  castingTime string, trigger condition included, is still shown in
   *  the floating spell card where there's room for it. */
  function buildResultSummary(spell) {
    const shortCastingTime = (spell.castingTime || '').split('(')[0].trim();
    const parts = [
      `Lv ${spell.level}`,
      spell.school,
      shortCastingTime,
    ];
    if (spell.range) parts.push(spell.range);
    if (spell.concentration) parts.push('Concentration');
    if (spell.ritual) parts.push('Ritual');
    if (spell.save) parts.push(`${spell.save} save`);
    if (spell.damageTypes.length) parts.push(spell.damageTypes.join('/'));
    return parts.filter(Boolean).join(' · ');
  }

  /** Renders the results overlay for the given list, or a short hint /
   *  empty state. Does not touch activeResults/highlightedIndex itself --
   *  callers are responsible for keeping those in sync with what's
   *  actually rendered, since arrow-key navigation depends on them. */
  function renderResultsOverlay(results, query) {
    el.results.innerHTML = '';

    if (query.length > 0 && query.length < MIN_QUERY_LENGTH) {
      el.results.innerHTML = `<div class="spellbook-hint">Napiš ještě aspoň ${MIN_QUERY_LENGTH - query.length} znak${MIN_QUERY_LENGTH - query.length === 1 ? '' : 'y'}...</div>`;
      el.results.style.display = 'block';
      return;
    }

    if (query.length === 0) {
      el.results.style.display = 'none';
      return;
    }

    if (!results.length) {
      el.results.innerHTML = `<div class="spellbook-hint">Žádná kouzla nenalezena.</div>`;
      el.results.style.display = 'block';
      return;
    }

    results.forEach((spell, idx) => {
      const row = document.createElement('div');
      row.className = 'spellbook-result-row' + (idx === highlightedIndex ? ' spellbook-result-row-highlighted' : '');
      row.dataset.index = String(idx);
      row.innerHTML = `
        <div class="spellbook-result-name">${escapeHtml(spell.name)}</div>
        <div class="spellbook-result-summary">${escapeHtml(buildResultSummary(spell))}</div>
      `;
      row.addEventListener('mouseenter', () => {
        highlightedIndex = idx;
        updateHighlight();
      });
      row.addEventListener('click', () => {
        openSpellCard(spell.id);
        closeResultsOverlay();
      });
      el.results.appendChild(row);
    });

    el.results.style.display = 'block';
  }

  /** Re-applies the highlighted class to the current highlightedIndex
   *  without rebuilding the whole overlay -- used by arrow-key navigation
   *  and mouse hover so neither one has to re-render from scratch. */
  function updateHighlight() {
    el.results.querySelectorAll('.spellbook-result-row').forEach((row) => {
      const isHighlighted = parseInt(row.dataset.index, 10) === highlightedIndex;
      row.classList.toggle('spellbook-result-row-highlighted', isHighlighted);
      if (isHighlighted) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function closeResultsOverlay() {
    el.results.style.display = 'none';
    el.results.innerHTML = '';
    activeResults = [];
    highlightedIndex = -1;
  }

  /** Runs a search for the current input value and renders the overlay.
   *  Per bullet A: 0-2 characters shows no results (just a short hint
   *  once at least 1 character is typed), 3+ characters searches and
   *  displays results. */
  function runSearch() {
    const query = el.searchInput.value.trim();

    if (query.length < MIN_QUERY_LENGTH) {
      activeResults = [];
      highlightedIndex = -1;
      renderResultsOverlay([], query);
      return;
    }

    activeResults = SpellLibrary.search(query);
    highlightedIndex = activeResults.length ? 0 : -1; // first result pre-highlighted, ready for Enter
    renderResultsOverlay(activeResults, query);
  }

  // -------------------------------------------------------------------
  // Floating spell card (bullet C)
  // -------------------------------------------------------------------

  /** Builds one labeled line for the card body, e.g. "Range: 150 ft.".
   *  Returns '' (skipped entirely) if the value is falsy/empty, so the
   *  card only shows fields that actually apply to this spell -- per
   *  bullet C, "readable during play, not cluttered". */
  function statLine(label, value) {
    if (!value) return '';
    return `<div class="spell-card-line"><span class="spell-card-line-label">${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
  }

  function buildSpellCardBody(spell) {
    const levelSchool = spell.level === 0 ? `Cantrip · ${spell.school}` : `Level ${spell.level} · ${spell.school}`;

    const tags = [];
    if (spell.concentration) tags.push('<span class="spell-card-tag spell-card-tag-conc">Concentration</span>');
    if (spell.ritual) tags.push('<span class="spell-card-tag spell-card-tag-ritual">Ritual</span>');

    const damageOrSave = [];
    if (spell.save) damageOrSave.push(`${spell.save} save`);
    if (spell.attackType) damageOrSave.push(`${spell.attackType} spell attack`);
    if (spell.damageTypes.length) damageOrSave.push(`${spell.damageTypes.join(', ')} damage`);

    const entriesHtml = spell.entries.map((p) => `<p class="spell-card-entry">${escapeHtml(p)}</p>`).join('');

    return `
      <div class="spell-card-subtitle">${escapeHtml(levelSchool)}${spell.source ? ` <span class="spell-card-source">(${escapeHtml(spell.source)})</span>` : ''}</div>
      ${tags.length ? `<div class="spell-card-tags">${tags.join('')}</div>` : ''}

      <div class="spell-card-stats">
        ${statLine('Casting Time', spell.castingTime)}
        ${statLine('Range', spell.range)}
        ${statLine('Components', spell.components)}
        ${statLine('Duration', spell.duration)}
        ${statLine('Area', spell.area)}
        ${statLine('Classes', spell.classes.join(', '))}
        ${statLine('Save / Attack', damageOrSave.join(' · '))}
        ${statLine('Conditions', spell.conditions.join(', '))}
      </div>

      <div class="spell-card-description">
        ${entriesHtml || '<p class="empty-hint-inline">Bez popisu.</p>'}
        ${spell.higherLevel ? `<div class="spell-card-higher-level"><strong>At Higher Levels.</strong> ${escapeHtml(spell.higherLevel)}</div>` : ''}
      </div>
    `;
  }

  function openSpellCard(spellId) {
    const spell = SpellLibrary.getById(spellId);
    if (!spell) return;

    cardOpenForId = spellId;
    el.cardTitle.textContent = spell.name;
    el.cardBody.innerHTML = buildSpellCardBody(spell);
    el.cardBody.scrollTop = 0; // bullet J: a newly opened card replaces content -- start scrolled to top
    el.card.style.display = 'block';
  }

  function closeSpellCard() {
    cardPinned = false;
    el.cardPinBtn.classList.remove('btn-primary');
    el.card.style.display = 'none';
    cardOpenForId = null;
  }

  // -------------------------------------------------------------------
  // Import (bullet F)
  // -------------------------------------------------------------------

  function handleImportFile(file) {
    Storage.readJsonFile(file)
      .then((json) => {
        const result = SpellLibrary.loadFromJson(json, false);
        Storage.saveSpells(SpellLibrary.getAll());
        if (result.errors.length) {
          showImportHint(`Načteno ${result.added} kouzel, ${result.skipped} přeskočeno.`);
        } else {
          showImportHint(`Načteno ${result.added} kouzel.`);
        }
        // Re-run the current search so newly imported spells show up
        // immediately if they match what's already typed.
        if (el.searchInput.value.trim().length >= MIN_QUERY_LENGTH) runSearch();
      })
      .catch((err) => showImportHint(String(err)));
  }

  /** Reuses the results overlay area to show a brief import status
   *  message, since the spellbook has no separate status element of its
   *  own (bullet J: keep the header lightweight, don't add more chrome
   *  than necessary). Auto-hides after a few seconds. */
  function showImportHint(message) {
    el.results.innerHTML = `<div class="spellbook-hint">${escapeHtml(message)}</div>`;
    el.results.style.display = 'block';
    clearTimeout(showImportHint._t);
    showImportHint._t = setTimeout(() => {
      if (el.searchInput.value.trim().length < MIN_QUERY_LENGTH) {
        el.results.style.display = 'none';
      }
    }, 3000);
  }

  // -------------------------------------------------------------------
  // Keyboard + click wiring
  // -------------------------------------------------------------------

  function isTypingTarget(target) {
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function wireEvents() {
    el.searchInput.addEventListener('input', runSearch);

    el.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!activeResults.length) return;
        highlightedIndex = (highlightedIndex + 1) % activeResults.length;
        updateHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!activeResults.length) return;
        highlightedIndex = (highlightedIndex - 1 + activeResults.length) % activeResults.length;
        updateHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && activeResults[highlightedIndex]) {
          openSpellCard(activeResults[highlightedIndex].id);
          closeResultsOverlay();
        }
      } else if (e.key === 'Escape') {
        // Per bullet A: Escape closes results first; if results are
        // already closed, it closes an open spell card; if neither is
        // open, it blurs the search input. Each Escape press does ONE
        // of these, falling through to the next only when the previous
        // has nothing to do -- so repeated Escapes step back cleanly
        // rather than all happening simultaneously on the first press.
        if (el.results.style.display !== 'none') {
          closeResultsOverlay();
        } else if (cardOpenForId) {
          closeSpellCard();
        } else {
          el.searchInput.blur();
        }
      }
    });

    el.importBtn.addEventListener('click', () => el.importInput.click());
    el.importInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleImportFile(file);
      el.importInput.value = '';
    });

    el.cardCloseBtn.addEventListener('click', closeSpellCard);
    el.cardPinBtn.addEventListener('click', () => {
      cardPinned = !cardPinned;
      el.cardPinBtn.classList.toggle('btn-primary', cardPinned);
    });

    // Click outside the search box / overlay closes the overlay (bullet A).
    document.addEventListener('click', (e) => {
      const container = el.searchInput.closest('.spellbook-search-container');
      if (container && container.contains(e.target)) return;
      closeResultsOverlay();
    });

    // Click outside the spell card closes it, unless pinned (bullet C),
    // mirroring the existing stat block popover's click-outside behavior.
    document.addEventListener('click', (e) => {
      if (!cardOpenForId || cardPinned) return;
      if (el.card.contains(e.target)) return;
      // Don't close if the click is what opened it (a result row) --
      // that listener already handles closing the overlay + opening the
      // card in the same tick, so this guard avoids an immediate re-close.
      if (e.target.closest && e.target.closest('.spellbook-result-row')) return;
      closeSpellCard();
    });

    // Global Alt+S shortcut + Escape handling that should work even when
    // focus is elsewhere in the app (bullet A: "Alt+S znovu focusne
    // Spellbook search" should work from anywhere).
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
        return;
      }
      // If focus is elsewhere (not the search input itself, which has its
      // own Escape handling above) and a spell card is open, Escape still
      // closes it -- matches the existing stat block popover's global
      // Escape behavior so the two floating panels feel consistent.
      if (e.key === 'Escape' && document.activeElement !== el.searchInput && cardOpenForId && !isTypingTarget(e.target)) {
        closeSpellCard();
      }
    });
  }

  // -------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function init() {
    cacheRefs();
    wireEvents();
  }

  return { init };
})();
