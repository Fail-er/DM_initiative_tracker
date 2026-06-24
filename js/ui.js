/**
 * ui.js
 * -----------------------------------------------------------------------
 * Renders the three-column layout and wires up all event listeners.
 * Talks to MonsterLibrary/PlayerLibrary (data.js/player.js) and Encounter
 * (encounter.js) for state, and to Storage (storage.js) for persistence.
 *
 * Rendering strategy: simple, deliberate re-renders of whole sections on
 * state change. The encounter is small (a handful of combatants), so
 * there's no need for diffing -- just keep the code readable.
 * -----------------------------------------------------------------------
 */

const UI = (() => {
  // Single "focused" combatant -- drives the right-hand detail panel.
  let selectedInstanceId = null;

  // Multi-select set for manual grouping: populated via checkbox clicks or
  // ctrl/shift+click on turn rows, independent of selectedInstanceId so
  // focusing a combatant for detail editing doesn't disturb a grouping pick.
  let selectedForGrouping = new Set();
  let lastClickedInstanceId = null; // anchor for shift+click range selection

  // Which left-panel library tab is showing.
  let activeLibraryTab = 'monsters'; // 'monsters' | 'players'

  // Tracks players whose library row is currently in "awaiting initiative"
  // mode: a player was just added via the Add button (with initiative
  // null) and the row is showing a single focused input + confirm button
  // in place of the normal Add control, until the DM types a value and
  // commits it. Keyed by player templateId -> the instanceId that was
  // just created, so confirming knows exactly which CombatantInstance to
  // update even if multiple players are mid-add at once (a common
  // scenario at the start of a fight).
  let awaitingInitiativeFor = new Map();

  // Reference to the opened Player View window, so clicking the button
  // again reuses/reloads it instead of opening a duplicate -- see the
  // click handler in wireTopLevelControls for the full reasoning.
  let playerViewWindowRef = null;

  // Undo history: up to UNDO_STACK_LIMIT deep-cloned snapshots of the
  // whole encounter state, pushed right before each mutation by the
  // mutate() wrapper. Undo pops the most recent one and restores it
  // wholesale -- simpler and far less error-prone than writing a manual
  // inverse for every individual action type (HP, conditions, grouping,
  // add/remove, sync...), at the cost of a small amount of memory for a
  // few JSON-cloned encounter snapshots, which is negligible for the
  // size of state this app deals with.
  let undoStack = [];
  const UNDO_STACK_LIMIT = 5;

  // Which accordion sections are open in the detail panel, keyed by
  // section key (see ACCORDION_DEFAULTS). Persists across re-renders
  // within the session but resets per newly-selected combatant so each
  // combatant opens with sensible defaults rather than remembering the
  // last combatant's accordion state.
  let accordionState = {};
  let accordionStateForInstanceId = null;

  // Floating stat block popover state: WHAT is open (tracked here) is
  // separate from pin/position/drag state (owned by the DraggablePanel
  // instance created in cacheRefs, below).
  let statblockOpenForId = null;
  // When the open popover is a library-template preview (not a live
  // encounter combatant), this holds { sourceType, templateId } instead.
  // The two are mutually exclusive -- only one of statblockOpenForId /
  // statblockOpenForTemplate is ever non-null at a time.
  let statblockOpenForTemplate = null;
  // Every monster/player can have its own independently pinned floating
  // card now -- each entry is a DraggablePanel instance spawned via
  // DraggablePanel.spawnDetached() at the moment the live preview was
  // pinned. Pinning a SECOND monster no longer destroys the first.
  let pinnedStatblockPanels = [];
  let statblockPanel = null; // DraggablePanel instance, created in cacheRefs
  let combatLogPanel = null; // DraggablePanel instance for the Combat Log, created in cacheRefs

  // ---- DOM refs (filled in init) ----
  let el = {};

  function cacheRefs() {
    el = {
      tabMonsters: document.getElementById('tab-monsters'),
      tabPlayers: document.getElementById('tab-players'),
      monsterTabContent: document.getElementById('monster-tab-content'),
      playerTabContent: document.getElementById('player-tab-content'),

      searchInput: document.getElementById('monster-search'),
      monsterResults: document.getElementById('monster-results'),
      importLibraryBtn: document.getElementById('import-library-btn'),
      importLibraryInput: document.getElementById('import-library-input'),

      playerResults: document.getElementById('player-results'),
      addAllPlayersBtn: document.getElementById('add-all-players-btn'),
      reloadPlayersBtn: document.getElementById('reload-players-btn'),
      playerViewBtn: document.getElementById('player-view-btn'),

      turnList: document.getElementById('turn-list'),
      roundCounter: document.getElementById('round-counter'),
      nextTurnBtn: document.getElementById('next-turn-btn'),
      prevTurnBtn: document.getElementById('prev-turn-btn'),
      nextRoundBtn: document.getElementById('next-round-btn'),
      newEncounterBtn: document.getElementById('new-encounter-btn'),
      rollInitiativeBtn: document.getElementById('roll-initiative-btn'),
      groupSelectedBtn: document.getElementById('group-selected-btn'),
      groupSelectionHint: document.getElementById('group-selection-hint'),
      exportEncounterBtn: document.getElementById('export-encounter-btn'),
      importEncounterBtn: document.getElementById('import-encounter-btn'),
      importEncounterInput: document.getElementById('import-encounter-input'),

      detailPanel: document.getElementById('detail-panel'),
      importStatus: document.getElementById('import-status'),

      statblockPopover: document.getElementById('statblock-popover'),
      statblockHeader: document.getElementById('statblock-popover-header'),
      statblockTitle: document.getElementById('statblock-popover-title'),
      statblockBody: document.getElementById('statblock-popover-body'),
      statblockCloseBtn: document.getElementById('statblock-close-btn'),
      statblockPinBtn: document.getElementById('statblock-pin-btn'),

      undoBtn: document.getElementById('undo-btn'),
      combatLogBtn: document.getElementById('combat-log-btn'),
      backupBtn: document.getElementById('backup-btn'),
      restoreBtn: document.getElementById('restore-btn'),
      restoreInput: document.getElementById('restore-input'),
      combatLogPanel: document.getElementById('combat-log-panel'),
      combatLogHeader: document.getElementById('combat-log-header'),
      combatLogBody: document.getElementById('combat-log-body'),
      combatLogExportBtn: document.getElementById('combat-log-export-btn'),
      combatLogPinBtn: document.getElementById('combat-log-pin-btn'),
      combatLogCloseBtn: document.getElementById('combat-log-close-btn'),
    };

    statblockPanel = DraggablePanel.create({
      panelEl: el.statblockPopover,
      headerEl: el.statblockHeader,
      pinBtn: el.statblockPinBtn,
      closeBtn: el.statblockCloseBtn,
      onClose: () => {
        statblockOpenForId = null;
        statblockOpenForTemplate = null;
      },
      onPinRequested: () => {
        const rect = el.statblockPopover.getBoundingClientRect();
        const detached = DraggablePanel.spawnDetached(el.statblockPopover, rect.left, rect.top);
        pinnedStatblockPanels.push(detached);
        // The live slot's job is done -- it hands off to the new
        // independent pinned card and frees itself for the next preview.
        statblockPanel.close();
      },
    });

    // Combat Log panel: a single persistent panel (not a "live preview
    // slot" like the statblock/spell card -- there's only ever one log),
    // so it just uses DraggablePanel.create() directly with normal
    // pin/drag/close behavior. No onPinRequested override needed.
    combatLogPanel = DraggablePanel.create({
      panelEl: el.combatLogPanel,
      headerEl: el.combatLogHeader,
      pinBtn: el.combatLogPinBtn,
      closeBtn: el.combatLogCloseBtn,
      onClose: () => {},
    });
  }

  /** Renders the Combat Log panel's entry list. Newest entry last (normal
   *  chronological reading order, like scrolling down a chat log) --
   *  the panel's body scrolls to the bottom after rendering so the DM
   *  always sees the most recent entries without having to scroll
   *  manually after every action. */
  function renderCombatLogBody() {
    const entries = CombatLog.getAll();
    if (!entries.length) {
      el.combatLogBody.innerHTML = '<p class="empty-hint">Log je prázdný. Zápisy se objeví, jak budeš hrát.</p>';
      return;
    }
    el.combatLogBody.innerHTML = entries.map((e) => `
      <div class="combat-log-entry">
        <span class="combat-log-round">Round ${e.round}:</span>
        <span class="combat-log-message">${escapeHtml(e.message)}</span>
      </div>
    `).join('');
    el.combatLogBody.scrollTop = el.combatLogBody.scrollHeight;
  }

  /** Opens the Combat Log panel, centered in the viewport (it has no
   *  anchor element to position relative to -- it's opened from a
   *  header button, not a specific row/icon, same situation as the
   *  spell card). Re-renders fresh content on every open so a panel
   *  left open from earlier doesn't show stale entries. */
  function openCombatLogPanel() {
    renderCombatLogBody();
    const wasHidden = el.combatLogPanel.style.display === 'none' || !el.combatLogPanel.style.display;
    if (wasHidden) el.combatLogPanel.style.display = 'block';
    const panelWidth = el.combatLogPanel.offsetWidth;
    const left = (window.innerWidth - panelWidth) / 2;
    const top = 80;
    combatLogPanel.showAt(left, top);
  }

  // -------------------------------------------------------------------
  // Shared stat-math helpers (used by stat strip + floating stat block)
  // -------------------------------------------------------------------

  /** D&D ability modifier from a raw score, e.g. 16 -> +3. */
  function abilityMod(score) {
    if (!Number.isFinite(score)) return 0;
    return Math.floor((score - 10) / 2);
  }

  function fmtMod(n) {
    return n >= 0 ? `+${n}` : `${n}`;
  }

  const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const ABILITY_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

  /**
   * Builds the "stat strip" markup (bullet D): abilities with modifier and
   * save bonus, passive scores, speed, and senses. Shared between monster
   * templates and player templates -- both expose abilities/saves in the
   * same { str, dex, con, int, wis, cha } shape, so this works for either
   * once the caller normalizes the source object's saves into that shape.
   *
   * @param abilities {str,dex,con,int,wis,cha} raw scores
   * @param saves {str,dex,con,int,wis,cha} save bonuses (already computed,
   *        not derived here -- monster saves and player savingThrows are
   *        both pre-computed bonuses in their respective templates)
   * @param passives {perception, insight, investigation} (insight/investigation may be null)
   * @param speed string
   * @param senses string
   */
  /** Renders the 6-box ability grid (STR-CHA, each showing score+modifier
   *  on top and the save bonus below) -- matches the visualization's
   *  box-per-ability layout. Lives directly in the detail panel's
   *  always-visible header area now, not inside a collapsible accordion
   *  section (the old "Quick Stats" accordion item has been retired;
   *  this replaces it). */
  function renderAbilityGrid(abilities, saves) {
    const boxes = ABILITY_KEYS.map((key) => {
      const score = abilities[key];
      const mod = abilityMod(score);
      const save = Number.isFinite(saves[key]) ? saves[key] : mod;
      return `
        <div class="ability-grid-box">
          <div class="ability-grid-label">${ABILITY_LABELS[key]}</div>
          <div class="ability-grid-score">${Number.isFinite(score) ? score : '–'} <span class="ability-grid-mod">${fmtMod(mod)}</span></div>
          <div class="ability-grid-save">Save <strong>${fmtMod(save)}</strong></div>
        </div>
      `;
    }).join('');
    return `<div class="ability-grid">${boxes}</div>`;
  }

  /** Renders the standalone Passive Perception / Speed / Senses line
   *  that sits below the ability grid, outside the accordion -- these
   *  are looked up often enough during play that the visualization
   *  keeps them always visible rather than tucked behind a collapsible
   *  section. */
  function renderPassiveRow(passives, speed, senses) {
    const passiveParts = [
      `<span class="passive-row-item">Passive Perception <strong>${passives.perception}</strong></span>`,
      passives.insight != null ? `<span class="passive-row-item">Passive Insight <strong>${passives.insight}</strong></span>` : '',
      passives.investigation != null ? `<span class="passive-row-item">Passive Investigation <strong>${passives.investigation}</strong></span>` : '',
      speed ? `<span class="passive-row-item">Speed <strong>${escapeHtml(speed)}</strong></span>` : '',
      senses ? `<span class="passive-row-item">Senses <strong>${escapeHtml(senses)}</strong></span>` : '',
    ].filter(Boolean);
    return `<div class="passive-row">${passiveParts.join('')}</div>`;
  }

  // -------------------------------------------------------------------
  // Accordion (bullet E): collapsible sections in the right-hand detail
  // panel. Each section has a key, a label, default-open state, and a
  // render function returning inner HTML (or null to skip the section
  // entirely if there's nothing to show).
  // -------------------------------------------------------------------

  function isAccordionOpen(key, defaultOpen) {
    if (!(key in accordionState)) accordionState[key] = defaultOpen;
    return accordionState[key];
  }

  function renderAccordionSection(key, label, defaultOpen, innerHtml) {
    if (innerHtml == null) return '';
    const open = isAccordionOpen(key, defaultOpen);
    return `
      <div class="accordion-section">
        <button class="accordion-header" data-accordion-key="${key}" type="button" aria-expanded="${open}">
          <span class="accordion-arrow">${open ? '▾' : '▸'}</span>
          <span class="accordion-header-label">${label}</span>
          <span class="accordion-arrow-end">${open ? '⌃' : '⌄'}</span>
        </button>
        <div class="accordion-body" ${open ? '' : 'style="display:none"'}>${innerHtml}</div>
      </div>
    `;
  }

  function wireAccordionToggles() {
    document.querySelectorAll('.accordion-header').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.accordionKey;
        accordionState[key] = !accordionState[key];
        renderDetail();
      });
    });
  }

  // -------------------------------------------------------------------
  // LEFT PANEL: library tabs
  // -------------------------------------------------------------------

  function switchLibraryTab(tab) {
    activeLibraryTab = tab;
    const isMonsters = tab === 'monsters';
    el.tabMonsters.classList.toggle('library-tab-active', isMonsters);
    el.tabPlayers.classList.toggle('library-tab-active', !isMonsters);
    el.tabMonsters.setAttribute('aria-selected', String(isMonsters));
    el.tabPlayers.setAttribute('aria-selected', String(!isMonsters));
    el.monsterTabContent.style.display = isMonsters ? '' : 'none';
    el.playerTabContent.style.display = isMonsters ? 'none' : '';
  }

  // -------------------------------------------------------------------
  // LEFT PANEL: monster library search + add-to-encounter
  // -------------------------------------------------------------------

  function renderLibraryResults() {
    const query = el.searchInput.value;
    const results = MonsterLibrary.search(query);
    el.monsterResults.innerHTML = '';

    if (!results.length) {
      el.monsterResults.innerHTML = '<p class="empty-hint">Žádná monstra nenalezena.</p>';
      return;
    }

    results.forEach((tpl) => {
      const row = document.createElement('div');
      row.className = 'monster-row';
      row.innerHTML = `
        <span class="monster-row-name">
          <span class="monster-row-name-text">${escapeHtml(tpl.name)}</span>
          <button class="statblock-info-btn" type="button" title="Stat block" aria-label="Zobrazit stat block">ⓘ</button>
        </span>
        <div class="monster-row-second-line">
          <span class="monster-row-meta">${escapeHtml(tpl.type)} &middot; CR ${escapeHtml(tpl.challengeRating)} &middot; ${escapeHtml(tpl.source)}</span>
          <div class="monster-row-actions">
            <input type="number" class="qty-input" value="1" min="1" max="20" aria-label="Počet kusů" />
            <button class="btn btn-add" type="button">Přidat</button>
          </div>
        </div>
      `;
      const qtyInput = row.querySelector('.qty-input');
      const addBtn = row.querySelector('.btn-add');
      const infoBtn = row.querySelector('.statblock-info-btn');

      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLibraryStatblockPopover('monster', tpl.id, infoBtn);
      });

      addBtn.addEventListener('click', () => {
        const count = parseInt(qtyInput.value, 10) || 1;
        mutate(
          count === 1 ? `${tpl.name} added to encounter` : `${count}x ${tpl.name} added to encounter`,
          () => {
            const added = Encounter.addFromTemplate(tpl, count);
            if (added.length) selectedInstanceId = added[added.length - 1].instanceId;
          }
        );
      });

      el.monsterResults.appendChild(row);
    });
  }

  function handleLibraryImport(file) {
    Storage.readJsonFile(file)
      .then((json) => {
        const result = MonsterLibrary.loadFromJson(json, false);
        Storage.saveLibrary(MonsterLibrary.getAll());
        renderLibraryResults();
        if (result.errors.length) {
          showImportStatus(
            `Načteno ${result.added} monster, ${result.skipped} přeskočeno. ${result.errors[0]}`,
            'warn'
          );
        } else {
          showImportStatus(`Načteno ${result.added} monster.`, 'ok');
        }
      })
      .catch((err) => {
        showImportStatus(String(err), 'error');
      });
  }

  function showImportStatus(message, kind) {
    el.importStatus.textContent = message;
    el.importStatus.className = 'import-status import-status-' + kind;
    el.importStatus.style.display = 'block';
    clearTimeout(showImportStatus._t);
    showImportStatus._t = setTimeout(() => {
      el.importStatus.style.display = 'none';
    }, 5000);
  }

  // -------------------------------------------------------------------
  // LEFT PANEL: player library, inline initiative input, Add / Add All
  // -------------------------------------------------------------------

  function renderPlayerResults() {
    const players = PlayerLibrary.getAll();
    el.playerResults.innerHTML = '';

    if (!players.length) {
      el.playerResults.innerHTML = '<p class="empty-hint">Žádní hráči v knihovně.</p>';
      return;
    }

    players.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'monster-row player-row';
      const awaitingInstanceId = awaitingInitiativeFor.get(p.id);
      const alreadyAdded = !awaitingInstanceId && Encounter.hasPlayerInstance(p.id);

      let actionsHtml;
      if (awaitingInstanceId) {
        actionsHtml = `
          <input type="number" class="qty-input player-init-input" placeholder="Init" aria-label="Iniciativa pro ${escapeHtml(p.name)}" />
          <button class="btn btn-add btn-primary" type="button">✓</button>
        `;
      } else if (alreadyAdded) {
        // Disabled, muted Add button: doubles as a checklist indicator of
        // who's already in the encounter, and a hard block against adding
        // the same player twice (no click handler is even attached below).
        actionsHtml = `<button class="btn btn-add" type="button" disabled title="${escapeHtml(p.name)} je už v encounteru">Added &#10003;</button>`;
      } else {
        actionsHtml = `<button class="btn btn-add" type="button">Add</button>`;
      }

      row.innerHTML = `
        <span class="monster-row-name">
          <span class="monster-row-name-text">${escapeHtml(p.name)}</span>
          <button class="statblock-info-btn" type="button" title="Stat block" aria-label="Zobrazit stat block">ⓘ</button>
        </span>
        <div class="monster-row-second-line">
          <span class="monster-row-meta">${escapeHtml(p.className)} ${p.level} &middot; AC ${p.armorClass} &middot; HP ${p.currentHp}/${p.maxHp}</span>
          <div class="monster-row-actions">${actionsHtml}</div>
        </div>
      `;

      const infoBtn = row.querySelector('.statblock-info-btn');
      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLibraryStatblockPopover('player', p.id, infoBtn);
      });

      if (awaitingInstanceId) {
        // Row is in "awaiting initiative" mode: the player is already in
        // the encounter (added with initiative null the moment Add was
        // clicked); this input only ever sets initiative on that existing
        // instance, it never adds another copy.
        const initInput = row.querySelector('.player-init-input');
        const confirmBtn = row.querySelector('.btn-add');

        const commitInitiative = () => {
          const raw = initInput.value.trim();
          const value = raw === '' ? null : parseInt(raw, 10);
          if (Number.isFinite(value)) {
            mutate(`${p.name} initiative set to ${value}`, () => {
              Encounter.setInitiative(awaitingInstanceId, value);
            });
          }
          awaitingInitiativeFor.delete(p.id);
          renderPlayerResults();
        };

        initInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commitInitiative();
        });
        confirmBtn.addEventListener('click', commitInitiative);

        // Autofocus so the DM can type the number immediately without an
        // extra click -- this is the whole point of the change.
        requestAnimationFrame(() => initInput.focus());
      } else if (!alreadyAdded) {
        // Normal mode: Add immediately creates the CombatantInstance with
        // initiative null and flips this row into "awaiting initiative".
        const addBtn = row.querySelector('.btn-add');
        addBtn.addEventListener('click', () => {
          mutate(`${p.name} added to encounter`, () => {
            const inst = Encounter.addPlayerFromTemplate(p, null);
            awaitingInitiativeFor.set(p.id, inst.instanceId);
            selectedInstanceId = inst.instanceId;
          });
          renderPlayerResults();
        });
      }
      // alreadyAdded case: button is disabled, no handler needed.

      el.playerResults.appendChild(row);
    });
  }

  /** Add All Players (bullet A): adds every player template not already
   *  present in the encounter (matched by templateId), each with no
   *  initiative set yet. The DM fills initiative in afterward per-combatant
   *  in the right-hand detail panel -- bulk-adding doesn't try to pop up
   *  an input for each one in turn, since that would be slower than just
   *  asking each player in sequence and using the single-Add flow below. */
  function handleAddAllPlayers() {
    const players = PlayerLibrary.getAll();
    const toAdd = players.filter((p) => !Encounter.hasPlayerInstance(p.id));
    if (!toAdd.length) return;

    mutate(`Add All Players (${toAdd.map((p) => p.name).join(', ')})`, () => {
      toAdd.forEach((p) => Encounter.addPlayerFromTemplate(p, null));
    });
    renderPlayerResults();
  }

  /** Re-reads the player library from localStorage and re-renders the
   *  Hráči tab (bullet B). This picks up changes made in Player Manager
   *  (player-editor.html), whether opened in another tab/window (where
   *  the 'storage' event fires automatically) or this same session
   *  (where the manual Reload Players button is the fallback). Does NOT
   *  touch any already-added CombatantInstances in the live encounter --
   *  that only happens via the explicit per-combatant Sync button. */
  function reloadPlayersFromStorage() {
    const saved = Storage.loadPlayers();
    if (saved && Array.isArray(saved.players)) {
      PlayerLibrary.loadFromJson(saved, true);
      renderPlayerResults();
      // If the detail panel is currently showing a player, its stat strip
      // reads live from PlayerLibrary.getById(), so refresh it too.
      if (selectedInstanceId) {
        const inst = Encounter.getInstance(selectedInstanceId);
        if (inst && inst.sourceType === 'player') renderDetail();
      }
    }
  }

  // -------------------------------------------------------------------
  // MIDDLE PANEL: turn order list
  // -------------------------------------------------------------------

  function renderEncounter() {
    const state = Encounter.getState();
    const ordered = Encounter.sortedInstances();
    const activeId = Encounter.getActiveInstanceId();

    el.roundCounter.textContent = `Kolo ${state.round}`;
    el.turnList.innerHTML = '';

    // Prune any grouping-selection of instances that no longer exist
    // (e.g. removed via import / new encounter).
    const liveIds = new Set(ordered.map((i) => i.instanceId));
    selectedForGrouping.forEach((id) => {
      if (!liveIds.has(id)) selectedForGrouping.delete(id);
    });
    updateGroupingControls();

    if (!ordered.length) {
      el.turnList.innerHTML = '<p class="empty-hint">Encounter je prázdný. Přidej monstra nebo hráče z levého panelu.</p>';
      renderDetail();
      return;
    }

    ordered.forEach((inst) => {
      const isActive = inst.instanceId === activeId;
      const isFocused = inst.instanceId === selectedInstanceId;
      const isGroupSelected = selectedForGrouping.has(inst.instanceId);
      const isPlayer = inst.sourceType === 'player';

      const row = document.createElement('div');
      row.className = [
        'turn-row',
        isActive ? 'turn-row-active' : '',
        isFocused ? 'turn-row-focused' : '',
        isGroupSelected ? 'turn-row-group-selected' : '',
        inst.isDead ? 'turn-row-dead' : '',
      ].filter(Boolean).join(' ');
      row.dataset.instanceId = inst.instanceId;
      row.setAttribute('tabindex', '0');
      row.setAttribute('role', 'button');

      const hpPct = inst.maxHp > 0 ? Math.max(0, Math.min(100, (inst.currentHp / inst.maxHp) * 100)) : 0;
      const hpBarClass = hpPct <= 25 ? 'hp-bar-fill-low' : hpPct <= 50 ? 'hp-bar-fill-mid' : 'hp-bar-fill-high';
      const initDisplay = inst.initiative === null ? '–' : inst.initiative;
      const badgeClass = isPlayer ? 'source-badge source-badge-pc' : 'source-badge source-badge-mon';
      const badgeText = isPlayer ? 'PC' : 'MON';

      const anonymizeBtnHtml = !isPlayer
        ? `<button class="anonymize-toggle-btn${inst.isAnonymized ? ' anonymize-toggle-btn-active' : ''}" type="button" data-instance-id="${inst.instanceId}" title="${inst.isAnonymized ? 'Zobrazit skutečné jméno v Player View' : 'Skrýt jméno v Player View (zobrazí se jako Nepřítel N)'}" aria-label="Přepnout anonymizaci v Player View">🎭</button>`
        : '';

      row.innerHTML = `
        <input type="checkbox" class="group-checkbox" ${isGroupSelected ? 'checked' : ''} aria-label="Vybrat do skupiny" />
        <div class="turn-row-init">${initDisplay}</div>
        <div class="turn-row-type"><span class="${badgeClass}">${badgeText}</span></div>
        <div class="turn-row-name-col">
          <div class="turn-row-name">
            ${isActive ? '<span class="active-marker" title="Aktivní tah">&#9876;</span>' : ''}
            <span class="turn-row-name-text">${escapeHtml(inst.publicName || inst.displayName)}</span>
            ${inst.isDead ? '<span class="dead-tag">DEAD</span>' : ''}
          </div>
        </div>
        <div class="turn-row-ac">${inst.armorClass}</div>
        <div class="turn-row-hp-col">
          <div class="turn-row-hp-text">${inst.currentHp}&nbsp;/&nbsp;${inst.maxHp}${inst.tempHp ? ' (+' + inst.tempHp + ')' : ''}</div>
          <div class="hp-bar">
            <div class="hp-bar-fill ${hpBarClass}" style="width:${hpPct}%"></div>
          </div>
        </div>
        <div class="turn-row-conditions-col">
          ${inst.conditions.length ? `<div class="condition-tags">${inst.conditions.map(c => buildConditionChip(c, false)).join('')}</div>` : '<span class="turn-row-no-conditions">—</span>'}
        </div>
        <div class="turn-row-actions">
          ${anonymizeBtnHtml}
          <button class="statblock-info-btn" type="button" data-instance-id="${inst.instanceId}" title="Stat block" aria-label="Zobrazit stat block">ⓘ</button>
          <button class="remove-instance-btn" type="button" data-instance-id="${inst.instanceId}" title="Odstranit z encounteru (Delete)" aria-label="Odstranit z encounteru">🗑</button>
        </div>
      `;

      const checkbox = row.querySelector('.group-checkbox');
      // Checkbox click is the touch-friendly path: toggle grouping selection
      // only, don't disturb the detail focus, and don't let the click bubble
      // up to the row handler (which would otherwise also toggle focus).
      // Note: this does NOT move the shift-click anchor -- only a plain
      // row click does that, so the anchor stays predictable.
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleGroupSelection(inst.instanceId);
        renderEncounter();
      });

      // The 🎭 button: toggles whether this monster shows its real name
      // or the generic "Nepřítel N" label in the Player View broadcast.
      // Monster-only (the button isn't rendered for players at all).
      // Takes effect on the next broadcast -- no separate "apply" step,
      // since broadcastPlayerView() reads isAnonymized fresh every time.
      const anonymizeBtn = row.querySelector('.anonymize-toggle-btn');
      if (anonymizeBtn) {
        anonymizeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          mutate(null, () => Encounter.toggleMonsterAnonymization(inst.instanceId));
        });
      }

      // The ⓘ button (bullet F): opens the floating stat block popover
      // WITHOUT selecting the row or disturbing focus/grouping state.
      const infoBtn = row.querySelector('.statblock-info-btn');
      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openStatblockPopover(inst.instanceId, infoBtn);
      });

      // The 🗑 button: permanently removes this combatant (with confirm),
      // for the "added it by mistake" case. Distinct from Dead, which
      // keeps the row visible but greyed out. Does not select the row.
      const removeBtn = row.querySelector('.remove-instance-btn');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestRemoveInstance(inst.instanceId);
      });

      // Row click: plain click toggles detail focus (click again to unfocus)
      // AND sets the shift-click anchor. Ctrl/Cmd+click toggles grouping
      // selection for just this row without moving the anchor. Shift+click
      // toggles the entire range between the anchor and this row: if every
      // row in that range is already selected, the whole range is cleared;
      // otherwise every row in the range is selected (gaps filled in).
      row.addEventListener('click', (e) => {
        if (e.shiftKey && lastClickedInstanceId) {
          toggleRange(lastClickedInstanceId, inst.instanceId, ordered);
          renderEncounter();
          return;
        }
        if (e.ctrlKey || e.metaKey) {
          toggleGroupSelection(inst.instanceId);
          renderEncounter();
          return;
        }
        lastClickedInstanceId = inst.instanceId;
        selectedInstanceId = (selectedInstanceId === inst.instanceId) ? null : inst.instanceId;
        renderEncounter();
      });

      el.turnList.appendChild(row);
    });

    renderDetail();
  }

  /** Toggles a single instance's membership in the grouping-selection set. */
  function toggleGroupSelection(instanceId) {
    if (selectedForGrouping.has(instanceId)) {
      selectedForGrouping.delete(instanceId);
    } else {
      selectedForGrouping.add(instanceId);
    }
  }

  /** Shift+click range toggle: works on the whole range between the anchor
   *  and the newly clicked row (inclusive, in current turn order). If every
   *  row in that range is already selected, the entire range is cleared --
   *  this is what lets shift+click remove rows, not just add them. Otherwise
   *  the entire range is selected (filling in any gaps). */
  function toggleRange(anchorId, targetId, ordered) {
    const ids = ordered.map((i) => i.instanceId);
    const a = ids.indexOf(anchorId);
    const b = ids.indexOf(targetId);
    if (a === -1 || b === -1) return;
    const [lo, hi] = a < b ? [a, b] : [b, a]; // direction-independent: works top-down or bottom-up
    const rangeIds = ids.slice(lo, hi + 1);

    const fullyCovered = rangeIds.every((id) => selectedForGrouping.has(id));
    if (fullyCovered) {
      rangeIds.forEach((id) => selectedForGrouping.delete(id));
    } else {
      rangeIds.forEach((id) => selectedForGrouping.add(id));
    }
  }

  /** Enables/disables the "Group Selected" button and updates the hint
   *  text based on how many combatants are currently picked for grouping. */
  function updateGroupingControls() {
    const count = selectedForGrouping.size;
    el.groupSelectedBtn.disabled = count < 2;
    el.groupSelectionHint.textContent = count > 0
      ? `Vybráno ${count} ${count === 1 ? 'combatant' : 'combatanti'} pro skupinu`
      : 'Vyber 2+ combatanty (checkbox nebo Ctrl/Shift+klik)';
  }

  // -------------------------------------------------------------------
  // RIGHT PANEL: selected combatant detail (accordion, bullet E)
  // -------------------------------------------------------------------

  function renderDetail() {
    if (!selectedInstanceId) {
      el.detailPanel.innerHTML = '<p class="empty-hint">Vyber combatanta v encounteru pro zobrazení detailu.</p>';
      return;
    }
    const inst = Encounter.getInstance(selectedInstanceId);
    if (!inst) {
      selectedInstanceId = null;
      el.detailPanel.innerHTML = '<p class="empty-hint">Vyber combatanta v encounteru pro zobrazení detailu.</p>';
      return;
    }

    // Reset accordion open/closed state to this combatant's defaults
    // whenever the SELECTED combatant changes (not on every re-render --
    // toggling a section and then e.g. adjusting HP shouldn't snap it
    // back closed).
    if (accordionStateForInstanceId !== inst.instanceId) {
      accordionState = {};
      accordionStateForInstanceId = inst.instanceId;
    }

    if (inst.sourceType === 'player') {
      renderPlayerDetail(inst);
    } else {
      renderMonsterDetail(inst);
    }

    wireDetailEvents(inst);
    wireAccordionToggles();
  }

  /** Maps a condition's durationType to the short chip suffix from
   *  bullet C: "rounds" shows the remaining count, the others show a
   *  fixed abbreviation. "manual" has no suffix at all -- the chip is
   *  just the condition name, exactly as before this feature existed. */
  function conditionDurationSuffix(c) {
    if (c.durationType === 'rounds') return Number.isFinite(c.roundsRemaining) ? String(c.roundsRemaining) : '';
    if (c.durationType === 'startOfTurn') return 'SOT';
    if (c.durationType === 'endOfTurn') return 'EOT';
    if (c.durationType === 'saveEnds') return 'Save';
    return '';
  }

  /** Builds one condition chip's HTML. Shared by the turn-row's
   *  read-only chips and the detail panel's removable chips -- `removable`
   *  controls whether a remove (×) button is included. Expired
   *  conditions get a small "!" marker and a muted/red-tinted style
   *  (bullet C: visually distinct but must not take up much space --
   *  no "Expired" text label, just the marker). */
  function buildConditionChip(c, removable) {
    const suffix = conditionDurationSuffix(c);
    const label = c.name === 'Concentration' ? 'Conc.' : c.name;
    const text = suffix ? `${escapeHtml(label)} · ${escapeHtml(suffix)}` : escapeHtml(label);
    const expiredClass = c.expired ? ' condition-tag-expired' : '';
    const expiredMark = c.expired ? '<span class="condition-tag-expired-mark" title="Vypršelo">!</span>' : '';
    const removeBtn = removable
      ? `<button class="condition-remove" data-condition-id="${c.id}" aria-label="Odebrat stav ${escapeHtml(c.name)}">&times;</button>`
      : '';
    return `<span class="condition-tag${removable ? ' condition-tag-removable' : ''}${expiredClass}" data-condition-id="${c.id}">${expiredMark}${text}${removeBtn}</span>`;
  }

  /** Shared header + stat row + HP block + conditions, used by both monster
   *  and player detail rendering so the fast-access controls (HP buttons,
   *  the three quick-HP fields, initiative, conditions) look and behave
   *  identically regardless of combatant type. */
  /** Renders the new compact always-visible header: a portrait
   *  placeholder (emoji for now -- wrapped in .detail-portrait so it can
   *  later be swapped for a real <img> without restructuring anything
   *  around it, once real artwork exists), name+source badge+DEAD tag,
   *  an AC "shield" stat, HP (colored red when low), and the editable
   *  Initiative field. Matches the visualization's header layout. */
  function renderDetailHeader(inst, subtitle) {
    const isPlayer = inst.sourceType === 'player';
    const badgeClass = isPlayer ? 'source-badge source-badge-pc' : 'source-badge source-badge-mon';
    const badgeText = isPlayer ? 'PC' : 'MON';
    const portraitIcon = isPlayer ? '🛡️' : '👹';
    const canReroll = inst.initiativeMode === 'auto';

    const hpPct = inst.maxHp > 0 ? Math.max(0, Math.min(100, (inst.currentHp / inst.maxHp) * 100)) : 0;
    const hpColorClass = hpPct <= 25 ? 'detail-hp-low' : hpPct <= 50 ? 'detail-hp-mid' : '';

    return `
      <div class="detail-header-v2">
        <div class="detail-portrait">${portraitIcon}</div>
        <div class="detail-header-main">
          <h2 class="detail-name">
            <span class="${badgeClass}">${badgeText}</span>
            ${escapeHtml(inst.publicName || inst.displayName)}${inst.isDead ? ' <span class="dead-tag">DEAD</span>' : ''}
          </h2>
          <div class="detail-sub">${subtitle}</div>
        </div>
        <div class="detail-header-stats">
          <div class="detail-stat-block">
            <div class="detail-stat-label">AC</div>
            <div class="detail-stat-icon detail-stat-icon-ac"><span class="detail-stat-icon-value">${inst.armorClass}</span></div>
          </div>
          <div class="detail-stat-block">
            <div class="detail-stat-label">HP</div>
            <div class="detail-stat-icon detail-stat-icon-hp ${hpColorClass}"><span class="detail-stat-icon-value">${inst.currentHp}/${inst.maxHp}</span></div>
          </div>
          <div class="detail-stat-block">
            <div class="detail-stat-label">Init</div>
            <div class="detail-stat-icon detail-stat-icon-init"><span class="detail-stat-icon-value">${inst.initiative === null ? '–' : inst.initiative}</span></div>
          </div>
        </div>
      </div>

      <div class="detail-stats">
        <div class="stat-box">
          <label for="detail-ac">AC</label>
          <input id="detail-ac" type="number" value="${inst.armorClass}" />
        </div>
        <div class="stat-box">
          <label for="detail-init">Iniciativa</label>
          <div class="init-input-row">
            <input id="detail-init" type="number" value="${inst.initiative === null ? '' : inst.initiative}" placeholder="–" />
            ${canReroll
              ? '<button id="reroll-init-btn" class="btn btn-small" type="button" title="Hodit znovu d20 + bonus">🎲</button>'
              : '<span class="manual-init-tag" title="Hráčská iniciativa se zadává ručně, nikdy se nepřehazuje automaticky">ruční</span>'}
          </div>
        </div>
      </div>
    `;
  }

  /** Renders the HP controls + conditions section that used to live
   *  inline in the detail panel -- now returned separately so it can
   *  become the "HP & Conditions" accordion item's body instead.
   *  Nothing about the controls themselves changed, only where their
   *  markup ends up in the overall panel. */
  function renderHpAndConditionsBody(inst) {
    const conditionAllOptions = Encounter.CONDITIONS
      .map((c) => `<option value="${c}">${c === 'Concentration' ? 'Concentration (Conc.)' : c}</option>`)
      .join('');

    return `
      <div class="detail-hp-block">
        <div class="hp-bar hp-bar-large">
          <div class="hp-bar-fill" style="width:${inst.maxHp > 0 ? Math.max(0, Math.min(100,(inst.currentHp/inst.maxHp)*100)) : 0}%"></div>
        </div>
        <div class="hp-numbers">${inst.currentHp} / ${inst.maxHp} HP${inst.tempHp ? ' (+' + inst.tempHp + ' temp)' : ''}</div>

        <div class="hp-btn-row">
          <button class="btn hp-btn" data-delta="-10">-10</button>
          <button class="btn hp-btn" data-delta="-5">-5</button>
          <button class="btn hp-btn" data-delta="-1">-1</button>
          <button class="btn hp-btn" data-delta="1">+1</button>
          <button class="btn hp-btn" data-delta="5">+5</button>
        </div>
        <div class="hp-btn-row">
          <button class="btn hp-btn-wide" id="hp-max-btn">Max</button>
          <button class="btn hp-btn-wide btn-danger" id="hp-dead-btn" title="Klávesa K">Dead</button>
          <button class="btn hp-btn-wide btn-danger" id="hp-remove-btn" title="Klávesa Delete">🗑 Odstranit</button>
        </div>

        <div class="hp-quick-row">
          <div class="hp-quick-field">
            <label for="hp-minus-input">- Zranění</label>
            <input type="number" id="hp-minus-input" class="hp-quick-input-num" min="0" placeholder="0" inputmode="numeric" />
          </div>
          <div class="hp-quick-field">
            <label for="hp-plus-input">+ Léčení</label>
            <input type="number" id="hp-plus-input" class="hp-quick-input-num" min="0" placeholder="0" inputmode="numeric" />
          </div>
          <div class="hp-quick-field">
            <label for="hp-set-input">= Nastavit HP</label>
            <input type="number" id="hp-set-input" class="hp-quick-input-num" placeholder="HP" inputmode="numeric" />
          </div>
        </div>
        <div class="hp-quick-hint">Enter v poli potvrdí změnu</div>
      </div>

      <div class="detail-section">
        <label class="detail-label">Stavy</label>
        <div class="condition-tags condition-tags-editable">
          ${inst.conditions.map((c) => buildConditionChip(c, true)).join('') || '<span class="empty-hint-inline">Žádné stavy</span>'}
        </div>
        <div class="condition-add-row">
          <select id="condition-select" class="condition-select">
            <option value="">Stav...</option>
            ${conditionAllOptions}
          </select>
          <select id="condition-duration-select" class="condition-duration-select" title="Trvání">
            <option value="manual" selected>Manual</option>
            <option value="rounds">Rounds</option>
            <option value="startOfTurn">Start of turn</option>
            <option value="endOfTurn">End of turn</option>
            <option value="saveEnds">Save ends</option>
          </select>
          <input type="number" id="condition-rounds-input" class="condition-rounds-input" min="1" placeholder="#" style="display:none" title="Počet kol" />
          <button id="condition-add-btn" class="btn btn-small" type="button">Add</button>
        </div>
      </div>
    `;
  }

  // ---- Monster detail --------------------------------------------------

  function renderMonsterDetail(inst) {
    const tpl = MonsterLibrary.getById(inst.templateId);
    const subtitle = tpl ? `${escapeHtml(tpl.type)} &middot; CR ${escapeHtml(tpl.challengeRating)}` : '';

    const headerHtml = renderDetailHeader(inst, subtitle);

    let alwaysVisibleHtml = '';
    if (tpl) {
      alwaysVisibleHtml += renderAbilityGrid(tpl.abilities, tpl.saves);
      alwaysVisibleHtml += renderPassiveRow(
        { perception: passivePerceptionFromSkills(tpl), insight: null, investigation: null },
        tpl.speed, tpl.senses
      );
    }

    let accordionHtml = renderAccordionSection('hp-conditions', 'HP & Conditions', true, renderHpAndConditionsBody(inst));

    if (tpl) {
      const savesSkillsHtml = renderSavesSkills(tpl.saves, tpl.skills);
      accordionHtml += renderAccordionSection('saves', 'Saves & Skills', false, savesSkillsHtml);

      const resistHtml = renderResistancesBlock(tpl.resistances, tpl.immunities, []);
      accordionHtml += renderAccordionSection('resist', 'Resistances / Immunities', false, resistHtml);

      const traitsHtml = tpl.traits.length ? renderNamedTextList(tpl.traits) : null;
      accordionHtml += renderAccordionSection('traits', 'Traits', false, traitsHtml);

      const actionsHtml = tpl.actions.length ? renderNamedTextList(tpl.actions) : null;
      accordionHtml += renderAccordionSection('actions', 'Actions', false, actionsHtml);
    } else {
      accordionHtml += `<p class="empty-hint">Šablona monstra "${escapeHtml(inst.templateId)}" nebyla v knihovně nalezena.</p>`;
    }

    const notesHtml = `<textarea id="detail-notes" class="detail-notes" placeholder="Poznámky k tomuto monstru...">${escapeHtml(inst.notes)}</textarea>`;
    accordionHtml += renderAccordionSection('notes', 'Notes', false, notesHtml);

    el.detailPanel.innerHTML = headerHtml + alwaysVisibleHtml + `<div class="accordion-plaque">${accordionHtml}</div>`;
  }

  /** Monster templates don't carry an explicit passive perception field in
   *  this app's data model (bullet doesn't define one) -- approximate it
   *  the standard D&D way: 10 + Perception skill bonus if listed, else
   *  10 + WIS modifier. Good enough for a quick DM reference. */
  function passivePerceptionFromSkills(tpl) {
    if (Number.isFinite(tpl.skills && tpl.skills.Perception)) {
      return 10 + tpl.skills.Perception;
    }
    return 10 + abilityMod(tpl.abilities && tpl.abilities.wis);
  }

  // ---- Player detail ------------------------------------------------------

  function renderPlayerDetail(inst) {
    const tpl = PlayerLibrary.getById(inst.templateId);
    const subtitle = tpl ? `${escapeHtml(tpl.className)} ${tpl.level}` : '';

    const headerHtml = renderDetailHeader(inst, subtitle);

    const syncButtonHtml = `
      <button id="sync-player-btn" class="btn btn-small sync-player-btn" type="button"
        title="Aktualizuje AC, max HP, initiative bonus a staty z knihovny. Nezmění currentHP, iniciativu ani stavy.">
        ⟲ Sync selected player from library
      </button>
    `;

    let alwaysVisibleHtml = '';
    if (tpl) {
      alwaysVisibleHtml += renderAbilityGrid(tpl.abilities, tpl.savingThrows);
      alwaysVisibleHtml += renderPassiveRow(
        { perception: tpl.passivePerception, insight: tpl.passiveInsight, investigation: tpl.passiveInvestigation },
        tpl.speed, tpl.senses
      );
    }

    let accordionHtml = renderAccordionSection('hp-conditions', 'HP & Conditions', true, renderHpAndConditionsBody(inst));

    if (tpl) {
      const skillsHtml = renderSkillsOnly(tpl.skills);
      accordionHtml += renderAccordionSection('saves', 'Saves & Skills', false, skillsHtml);

      const abilitiesHtml = tpl.importantAbilities.length ? renderNamedTextList(tpl.importantAbilities) : null;
      accordionHtml += renderAccordionSection('important-abilities', 'Important Abilities', false, abilitiesHtml);
    } else {
      accordionHtml += `<p class="empty-hint">Šablona hráče "${escapeHtml(inst.templateId)}" nebyla v knihovně nalezena.</p>`;
    }

    const notesValue = inst.notes || (tpl ? tpl.notes : '');
    const notesHtml = `<textarea id="detail-notes" class="detail-notes" placeholder="Poznámky...">${escapeHtml(notesValue)}</textarea>`;
    accordionHtml += renderAccordionSection('notes', 'Notes', false, notesHtml);

    el.detailPanel.innerHTML = headerHtml + syncButtonHtml + alwaysVisibleHtml + `<div class="accordion-plaque">${accordionHtml}</div>`;

    const syncBtn = document.getElementById('sync-player-btn');
    syncBtn.addEventListener('click', () => {
      const freshTpl = PlayerLibrary.getById(inst.templateId);
      if (!freshTpl) {
        alert(`Šablona hráče "${inst.templateId}" nebyla v knihovně nalezena. Zkus nejdřív Reload Players.`);
        return;
      }
      mutate(`${inst.publicName || inst.displayName} synced from library`, () => {
        Encounter.syncPlayerFromTemplate(inst.instanceId, freshTpl);
      });
    });
  }

  // ---- Shared accordion-section content renderers -----------------------

  function renderSavesSkills(saves, skills) {
    const skillRows = Object.entries(skills || {})
      .map(([name, bonus]) => `<div class="skill-row"><span>${escapeHtml(name)}</span><span>${fmtMod(bonus)}</span></div>`)
      .join('');
    return `
      <div class="skills-list">
        ${skillRows || '<span class="empty-hint-inline">Žádné skills uvedeny</span>'}
      </div>
    `;
  }

  function renderSkillsOnly(skills) {
    const skillRows = Object.entries(skills || {})
      .map(([name, bonus]) => `<div class="skill-row"><span>${escapeHtml(name)}</span><span>${fmtMod(bonus)}</span></div>`)
      .join('');
    return `<div class="skills-list">${skillRows || '<span class="empty-hint-inline">Žádné skills uvedeny</span>'}</div>`;
  }

  function renderResistancesBlock(resistances, immunities, vulnerabilities) {
    if (!resistances.length && !immunities.length && !vulnerabilities.length) return null;
    const line = (label, list) => list.length
      ? `<div class="resist-row"><span class="resist-label">${label}</span><span>${list.map(escapeHtml).join(', ')}</span></div>`
      : '';
    return line('Resistances', resistances) + line('Immunities', immunities) + line('Vulnerabilities', vulnerabilities);
  }

  function renderNamedTextList(items) {
    return items.map((item) => `
      <div class="trait-block">
        <span class="trait-name">${escapeHtml(item.name)}.</span> ${escapeHtml(item.text)}
      </div>
    `).join('');
  }

  /** Builds a log-message function for an HP-changing action that
   *  detects whether the action ALSO killed the combatant (HP hit 0),
   *  appending "and died" when that's a NEW transition -- not when the
   *  combatant was already dead before this action ran (e.g. further
   *  damage to a corpse shouldn't re-announce a death that already
   *  happened). Returns a function suitable for passing directly as
   *  mutate()'s logMessage argument. */
  function hpChangeMessage(instanceId, baseMessage) {
    const before = Encounter.getInstance(instanceId);
    const wasAlreadyDead = !!(before && before.isDead);
    return () => {
      const current = Encounter.getInstance(instanceId);
      const justDied = current && current.isDead && !wasAlreadyDead;
      return justDied ? `${baseMessage} and died` : baseMessage;
    };
  }

  /** Shows the concentration-check reminder toast (bullet G) if this
   *  combatant currently has the Concentration condition. Called ONLY
   *  from actual damage paths (negative HP delta, or a setHp() call that
   *  lowers current HP) -- never from healing, Max HP, AC changes, or
   *  adding a condition, per the explicit exclusion list in the spec.
   *  This module makes no attempt to track WHAT spell the concentration
   *  is for, nor to clear/adjust it automatically -- it's purely a
   *  reminder that the DM still has to ask for/resolve the check
   *  themselves. */
  function checkConcentrationOnDamage(instanceId, damageAmount) {
    const inst = Encounter.getInstance(instanceId);
    if (!inst) return;
    const hasConcentration = inst.conditions.some((c) => c.name === 'Concentration');
    if (!hasConcentration) return;
    const label = inst.publicName || inst.displayName;
    showReminderToast(`Concentration check for ${label}, damage ${damageAmount}.`);
  }

  function wireDetailEvents(inst) {
    const name = inst.publicName || inst.displayName;

    const acInput = document.getElementById('detail-ac');
    acInput.addEventListener('change', () => {
      const newAc = parseInt(acInput.value, 10) || 0;
      const oldAc = inst.armorClass;
      if (newAc === oldAc) return;
      mutate(`${name} AC changed from ${oldAc} to ${newAc}`, () => {
        inst.armorClass = newAc;
      });
    });

    const initInput = document.getElementById('detail-init');
    initInput.addEventListener('change', () => {
      const raw = initInput.value.trim();
      const value = raw === '' ? null : parseInt(raw, 10);
      mutate(
        value === null ? `${name} initiative cleared` : `${name} initiative set to ${value}`,
        () => Encounter.setInitiative(inst.instanceId, value)
      );
    });

    // Re-roll button only exists for initiativeMode === "auto" (monsters);
    // for "manual" (players) the template renders a static "ruční" tag
    // instead, so there's nothing to wire here in that case.
    const rerollBtn = document.getElementById('reroll-init-btn');
    if (rerollBtn) {
      rerollBtn.addEventListener('click', () => {
        mutate(`${name} initiative re-rolled`, () => Encounter.rollInitiativeFor(inst.instanceId));
      });
    }

    document.querySelectorAll('.hp-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = parseInt(btn.dataset.delta, 10);
        const baseMsg = delta < 0
          ? `${name} took ${-delta} damage`
          : `${name} healed ${delta}`;
        mutate(hpChangeMessage(inst.instanceId, baseMsg), () => Encounter.applyDelta(inst.instanceId, delta));
        if (delta < 0) checkConcentrationOnDamage(inst.instanceId, -delta);
      });
    });

    document.getElementById('hp-max-btn').addEventListener('click', () => {
      mutate(`${name} HP set to max`, () => Encounter.setMax(inst.instanceId));
    });

    document.getElementById('hp-dead-btn').addEventListener('click', () => {
      mutate(`${name} marked Dead`, () => Encounter.markDead(inst.instanceId));
    });

    document.getElementById('hp-remove-btn').addEventListener('click', () => {
      requestRemoveInstance(inst.instanceId);
    });

    // Three dedicated HP quick-entry fields -- no sign typing required.
    // Each commits on Enter and clears itself so it's ready for the next hit.
    const minusInput = document.getElementById('hp-minus-input');
    minusInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const n = parseInt(minusInput.value, 10);
      if (Number.isFinite(n) && n > 0) {
        mutate(hpChangeMessage(inst.instanceId, `${name} took ${n} damage`), () => Encounter.applyDelta(inst.instanceId, -n));
        checkConcentrationOnDamage(inst.instanceId, n);
        minusInput.value = '';
      }
    });

    const plusInput = document.getElementById('hp-plus-input');
    plusInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const n = parseInt(plusInput.value, 10);
      if (Number.isFinite(n) && n > 0) {
        mutate(`${name} healed ${n}`, () => Encounter.applyDelta(inst.instanceId, n));
        plusInput.value = '';
      }
    });

    const setInput = document.getElementById('hp-set-input');
    setInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const n = parseInt(setInput.value, 10);
      if (Number.isFinite(n)) {
        const hpBefore = Encounter.getInstance(inst.instanceId).currentHp;
        mutate(hpChangeMessage(inst.instanceId, `${name} HP set to ${n}`), () => Encounter.setHp(inst.instanceId, n));
        if (n < hpBefore) checkConcentrationOnDamage(inst.instanceId, hpBefore - n);
        setInput.value = '';
      }
    });

    const conditionSelect = document.getElementById('condition-select');
    const durationSelect = document.getElementById('condition-duration-select');
    const roundsInput = document.getElementById('condition-rounds-input');
    const addConditionBtn = document.getElementById('condition-add-btn');

    durationSelect.addEventListener('change', () => {
      roundsInput.style.display = durationSelect.value === 'rounds' ? '' : 'none';
    });

    addConditionBtn.addEventListener('click', () => {
      const conditionName = conditionSelect.value;
      if (!conditionName) return;

      const durationType = durationSelect.value;
      const roundsRemaining = durationType === 'rounds' ? parseInt(roundsInput.value, 10) : null;
      if (durationType === 'rounds' && !Number.isFinite(roundsRemaining)) return; // need a count to proceed

      const suffix = durationType === 'rounds' ? ` (${roundsRemaining} rounds)`
        : durationType === 'manual' ? ''
        : ` (${durationType})`;
      mutate(`${name} gained ${conditionName}${suffix}`, () => {
        Encounter.addCondition(inst.instanceId, conditionName, { durationType, roundsRemaining });
      });

      // Reset the form back to its defaults after a successful add, per
      // the agreed flow -- the next condition added starts fresh rather
      // than inheriting the previous one's duration settings.
      conditionSelect.value = '';
      durationSelect.value = 'manual';
      roundsInput.value = '';
      roundsInput.style.display = 'none';
    });

    document.querySelectorAll('.condition-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const conditionId = btn.dataset.conditionId;
        const removedCondition = inst.conditions.find((c) => c.id === conditionId);
        const conditionName = removedCondition ? removedCondition.name : 'condition';
        mutate(`${name} lost ${conditionName}`, () => Encounter.removeCondition(inst.instanceId, conditionId));
      });
    });

    const notesArea = document.getElementById('detail-notes');
    notesArea.addEventListener('input', () => {
      Encounter.setNotes(inst.instanceId, notesArea.value);
      // Notes autosave to storage, but don't need a full re-render.
      Storage.saveEncounter(Encounter.getState());
    });
  }

  // -------------------------------------------------------------------
  // Floating stat block popover (bullet F)
  // -------------------------------------------------------------------

  /** Builds the floating stat block body from a PlayerTemplate. hpText is
   *  the already-formatted HP string to show -- callers pass either a live
   *  combatant's "current/max" or, for a library-only lookup with no
   *  CombatantInstance yet, the template's own currentHp/maxHp as a
   *  preview (bullet: "look before adding to the tracker"). */
  function buildStatblockBodyForPlayerTemplate(tpl, hpText) {
    const abilityRows = ABILITY_KEYS.map((key) => {
      const score = tpl.abilities[key];
      const mod = abilityMod(score);
      const save = Number.isFinite(tpl.savingThrows[key]) ? tpl.savingThrows[key] : mod;
      return `<div class="statblock-ability-row"><span>${ABILITY_LABELS[key]}</span><span>${score} (${fmtMod(mod)})</span><span class="statblock-save">Save ${fmtMod(save)}</span></div>`;
    }).join('');
    return `
      <div class="statblock-line"><strong>AC</strong> ${tpl.armorClass} &middot; <strong>HP</strong> ${hpText} &middot; <strong>Speed</strong> ${escapeHtml(tpl.speed)}</div>
      <div class="statblock-abilities">${abilityRows}</div>
      <div class="statblock-line"><strong>Passive Perception</strong> ${tpl.passivePerception}</div>
      ${tpl.importantAbilities.length ? `<div class="statblock-section-title">Important Abilities</div>${renderNamedTextList(tpl.importantAbilities)}` : ''}
    `;
  }

  /** Same as above, for a MonsterTemplate. */
  function buildStatblockBodyForMonsterTemplate(tpl, hpText) {
    const abilityRows = ABILITY_KEYS.map((key) => {
      const score = tpl.abilities[key];
      const mod = abilityMod(score);
      const save = Number.isFinite(tpl.saves[key]) ? tpl.saves[key] : mod;
      return `<div class="statblock-ability-row"><span>${ABILITY_LABELS[key]}</span><span>${score != null ? score : '–'} (${fmtMod(mod)})</span><span class="statblock-save">Save ${fmtMod(save)}</span></div>`;
    }).join('');
    const resist = renderResistancesBlock(tpl.resistances, tpl.immunities, []);
    return `
      <div class="statblock-line"><strong>AC</strong> ${tpl.armorClass} &middot; <strong>HP</strong> ${hpText} &middot; <strong>Speed</strong> ${escapeHtml(tpl.speed)}</div>
      <div class="statblock-abilities">${abilityRows}</div>
      <div class="statblock-line"><strong>Passive Perception</strong> ${passivePerceptionFromSkills(tpl)}</div>
      ${resist ? `<div class="statblock-section-title">Resistances / Immunities</div>${resist}` : ''}
      ${tpl.actions.length ? `<div class="statblock-section-title">Actions</div>${renderNamedTextList(tpl.actions)}` : ''}
    `;
  }

  /** Builds the floating stat block body for a LIVE encounter combatant
   *  (used by the turn-row ⓘ button): shows current/max HP from the
   *  instance, not just the template's starting value. */
  function buildStatblockBody(inst) {
    if (inst.sourceType === 'player') {
      const tpl = PlayerLibrary.getById(inst.templateId);
      if (!tpl) return '<p class="empty-hint">Šablona nenalezena.</p>';
      return buildStatblockBodyForPlayerTemplate(tpl, `${inst.currentHp}/${inst.maxHp}`);
    }
    const tpl = MonsterLibrary.getById(inst.templateId);
    if (!tpl) return '<p class="empty-hint">Šablona nenalezena.</p>';
    return buildStatblockBodyForMonsterTemplate(tpl, `${inst.currentHp}/${inst.maxHp}`);
  }

  /** Builds the floating stat block body straight from a LIBRARY template,
   *  with no live CombatantInstance involved yet (used by the ⓘ button in
   *  the left-panel library lists, for previewing before adding to the
   *  encounter). HP shows just the template's starting value, since there's
   *  no "current" HP to speak of outside of an actual encounter. */
  function buildStatblockBodyFromTemplate(sourceType, tpl) {
    if (sourceType === 'player') {
      return buildStatblockBodyForPlayerTemplate(tpl, `${tpl.currentHp}/${tpl.maxHp}`);
    }
    return buildStatblockBodyForMonsterTemplate(tpl, `${tpl.hitPoints}`);
  }

  /** Opens the floating popover near the clicked ⓘ button, for a LIVE
   *  encounter combatant. Position is computed from the button's bounding
   *  rect, clamped so the popover never overflows the viewport (bullet F:
   *  "internal panel/modal", not a new window, and it should stay fully
   *  visible regardless of where in the turn list the user clicked).
   *  Every open resets any prior drag offset -- the panel always starts
   *  at this anchor-derived position, per the agreed behavior. */
  function openStatblockPopover(instanceId, anchorEl) {
    const inst = Encounter.getInstance(instanceId);
    if (!inst) return;

    statblockOpenForId = instanceId;
    statblockOpenForTemplate = null;
    el.statblockTitle.textContent = inst.publicName || inst.displayName;
    el.statblockBody.innerHTML = buildStatblockBody(inst);
    positionStatblockPopover(anchorEl);
  }

  /** Opens the floating popover for a LIBRARY template -- no live
   *  CombatantInstance involved, used by the left-panel ⓘ buttons so the
   *  DM can preview a monster/player before adding it to the encounter.
   *  Sets statblockOpenForTemplate (not statblockOpenForId) so the
   *  click-outside/Escape handling and the live-update-on-change logic in
   *  persistAndRerenderEncounter() can tell the two cases apart -- a
   *  library preview has nothing in the encounter to stay in sync with,
   *  so it's simpler and shouldn't try to "live update" itself. */
  function openLibraryStatblockPopover(sourceType, templateId, anchorEl) {
    const tpl = sourceType === 'player' ? PlayerLibrary.getById(templateId) : MonsterLibrary.getById(templateId);
    if (!tpl) return;

    statblockOpenForId = null;
    statblockOpenForTemplate = { sourceType, templateId };
    el.statblockTitle.textContent = tpl.name;
    el.statblockBody.innerHTML = buildStatblockBodyFromTemplate(sourceType, tpl);
    positionStatblockPopover(anchorEl);
  }

  /** Computes an anchor-relative position (below the ⓘ button, flipping
   *  above it if there's no room below) and hands off to the
   *  DraggablePanel for the actual display/clamp/z-index work. */
  function positionStatblockPopover(anchorEl) {
    // Make it visible first (display:block) so its real offsetWidth/
    // offsetHeight are available for the flip-above check below --
    // showAt() will reset display anyway, but we need a measurement
    // before computing where to put it.
    el.statblockPopover.style.display = 'block';

    const anchorRect = anchorEl.getBoundingClientRect();
    const popRect = el.statblockPopover.getBoundingClientRect();
    const margin = 8;

    let top = anchorRect.bottom + margin;
    const left = anchorRect.left;

    if (top + popRect.height > window.innerHeight - margin) {
      // Not enough room below -- flip above the anchor instead.
      top = anchorRect.top - popRect.height - margin;
      if (top < margin) top = margin;
    }

    statblockPanel.showAt(left, top);
  }

  /** Closes the popover ONLY if it isn't pinned -- used by click-outside
   *  and the non-forced Escape path. */
  function closeStatblockPopover() {
    statblockPanel.requestClose();
  }

  /** Force-closes the popover regardless of pin state -- used by the
   *  Close button (via DraggablePanel directly) and by callers elsewhere
   *  in this file that need to guarantee the popover is gone (e.g. after
   *  removing the combatant it's showing). */
  function forceCloseStatblockPopover() {
    statblockPanel.close();
  }

  // -------------------------------------------------------------------
  // Shared re-render + persistence helper
  // -------------------------------------------------------------------

  /**
   * Central wrapper for every encounter-mutating action. Three things
   * happen, in order:
   *   1. The current encounter state is deep-cloned, and the combat
   *      log's current length is recorded, both pushed onto the undo
   *      stack (capped at UNDO_STACK_LIMIT) BEFORE the mutation -- this
   *      is what makes performUndo() able to restore "the state right
   *      before this action" later, log included.
   *   2. actionFn() runs the actual Encounter.* mutation(s).
   *   3. If logMessage is non-null, it's recorded to CombatLog tagged
   *      with the round the action happened in. Passing null skips
   *      logging entirely -- used for noisy/uninteresting changes like
   *      notes text, where a log entry per keystroke would be useless.
   * Finally, persistAndRerenderEncounter() runs as it always did, so
   * every call site that previously called an Encounter.* mutation
   * directly and then persistAndRerenderEncounter() can simply wrap
   * both into a single mutate() call instead.
   */
  /** Displays each reminder message returned by Encounter.nextTurn() /
   *  nextRound() (condition-duration expirations, save-ends reminders)
   *  as its own toast. A single turn transition can return several
   *  messages at once (e.g. a Next Round that both ends one combatant's
   *  turn and starts another's), so each gets shown independently
   *  rather than being concatenated into one toast. */
  function showTurnReminders(messages) {
    (messages || []).forEach((msg) => showReminderToast(msg));
  }

  function mutate(logMessage, actionFn) {
    const encounterSnapshot = JSON.parse(JSON.stringify(Encounter.getState()));
    const logCountBefore = CombatLog.count();
    undoStack.push({ encounterSnapshot, logCountBefore });
    if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
    updateUndoButtonState();

    // actionFn is expected to perform the Encounter.* mutation AND any
    // related UI-local state updates (e.g. setting selectedInstanceId to
    // a newly-added instance) before this function moves on to logging
    // and re-rendering -- so callers can do everything they need inside
    // the closure passed here, same as they did inline before this
    // wrapper existed.
    actionFn();

    // logMessage may be a plain string (decided before the action ran,
    // for actions whose outcome is already fully known up front) OR a
    // function (called now, AFTER actionFn, so it can inspect the
    // resulting state -- e.g. HP damage that also brought a combatant to
    // 0 and killed it needs to describe BOTH things, which isn't known
    // until after applyDelta() has actually run).
    const resolvedMessage = typeof logMessage === 'function' ? logMessage() : logMessage;

    if (resolvedMessage) {
      const round = Encounter.getState().round;
      CombatLog.add(round, resolvedMessage);
      Storage.saveCombatLog(CombatLog.getAll());
    }

    persistAndRerenderEncounter();
  }

  /** Reflects whether there's anything to undo in the button's
   *  enabled/disabled state, so the DM gets a clear visual signal rather
   *  than clicking Undo and having nothing happen with no explanation. */
  function updateUndoButtonState() {
    el.undoBtn.disabled = undoStack.length === 0;
  }

  /** Pops the most recent undo entry (encounter snapshot + the combat
   *  log's length right before that action) and restores both: the
   *  encounter state wholesale via Encounter.setState(), and the combat
   *  log trimmed back to exactly its pre-action length -- so whatever
   *  log entries that action created are removed too, keeping the log
   *  consistent with what's actually still true of the encounter.
   *  Undoing is not itself an undoable/loggable action -- it just steps
   *  back through existing history, and removing log entries here is
   *  the log's own history correcting itself, not a new event to record. */
  function performUndo() {
    if (!undoStack.length) return;
    const { encounterSnapshot, logCountBefore } = undoStack.pop();
    Encounter.setState(encounterSnapshot);
    CombatLog.truncateTo(logCountBefore);
    Storage.saveCombatLog(CombatLog.getAll());
    selectedForGrouping.clear();
    updateUndoButtonState();
    persistAndRerenderEncounter();
  }

  function persistAndRerenderEncounter() {
    Storage.saveEncounter(Encounter.getState());
    renderEncounter();
    broadcastPlayerView();
    // Keep an open, unpinned popover in sync with live HP/condition changes;
    // re-open it against its own (still-visible) anchor button if present.
    if (statblockOpenForId) {
      const inst = Encounter.getInstance(statblockOpenForId);
      if (inst) {
        el.statblockBody.innerHTML = buildStatblockBody(inst);
      } else {
        forceCloseStatblockPopover();
      }
    }
    // Keep the Combat Log panel's content current if it's open, so a new
    // entry from whatever action just ran appears immediately.
    if (el.combatLogPanel.style.display !== 'none') {
      renderCombatLogBody();
    }
  }

  /**
   * Builds the reduced, spoiler-safe payload for the player-view window
   * and sends it over PlayerViewChannel. Per the agreed scope, this
   * INCLUDES: name/streamLabel (monsters always show as "Nepřítel N",
   * never their real name -- see encounter.js's streamLabel assignment),
   * initiative value, turn order (already sorted), who's currently
   * active, conditions, and dead status. This EXCLUDES: HP entirely, AC,
   * and anything else that isn't on this explicit list -- the player
   * view is intentionally minimal, not a read-only mirror of the DM's
   * full turn list.
   */
  function broadcastPlayerView() {
    const state = Encounter.getState();
    const activeId = Encounter.getActiveInstanceId();

    // Dead monsters are excluded from the player view entirely -- unlike
    // players (who may still need their turn for a death save and stay
    // visible even at 0 HP), monsters have no equivalent mechanic once
    // dead, and Next Turn already skips them (see encounter.js's
    // isSkippableForTurnOrder). Filtering them out here keeps the
    // player-facing list showing only "live" turn order, never a corpse
    // lingering in the list.
    const visible = Encounter.sortedInstances().filter((inst) => {
      return !(inst.sourceType === 'monster' && inst.isDead);
    });

    PlayerViewChannel.send({
      round: state.round,
      activeInstanceId: activeId,
      combatants: visible.map((inst) => {
        // Monsters show their real name by default; only an explicitly
        // anonymized monster falls back to the generic "Nepřítel N"
        // label. Players are never anonymized -- their streamLabel IS
        // their real name, so the same expression naturally resolves
        // correctly for them too without a separate branch.
        const label = (inst.sourceType === 'monster' && inst.isAnonymized)
          ? inst.streamLabel
          : (inst.publicName || inst.displayName);

        return {
          instanceId: inst.instanceId,
          label,
          initiative: inst.initiative,
          isActive: inst.instanceId === activeId,
          isDead: inst.isDead,
          // Player view shows condition NAMES only -- duration/expired
          // detail is a DM-only concept, not something to surface to
          // players/viewers.
          conditions: inst.conditions.map((c) => c.name),
        };
      }),
    });
  }

  /** Reloads and refocuses an already-open Player View window. Used by
   *  both branches of the Player View button click handler -- whether
   *  the window was already tracked in playerViewWindowRef, or only just
   *  rediscovered via a same-name window.open() call. Reloading (rather
   *  than just focusing) is deliberate per the request: it's the "in
   *  case it's frozen" recovery path, and OBS's Window Capture keeps
   *  pointing at the same window handle either way since the window
   *  itself is never closed or recreated. */
  function reloadAndFocusPlayerView(win) {
    try {
      win.location.reload();
      win.focus();
    } catch (e) {
      // Inaccessible for some reason -- shouldn't happen for a
      // same-origin file this app opened itself, but fail safely rather
      // than throwing if it does.
    }
  }

  /** Permanently removes a combatant from the encounter, after a
   *  confirmation dialog (mirrors the New Encounter confirm pattern --
   *  this is the one truly destructive per-combatant action, distinct
   *  from Dead, which just marks status and keeps the row visible).
   *  Cleans up any selection/grouping/popover state pointing at the
   *  removed instance so nothing dangles. */
  function requestRemoveInstance(instanceId) {
    const inst = Encounter.getInstance(instanceId);
    if (!inst) return;
    const name = inst.publicName || inst.displayName;
    if (!confirm(`Odstranit "${name}" z encounteru?`)) return;

    mutate(`${name} removed from encounter`, () => {
      Encounter.removeInstance(instanceId);
      if (selectedInstanceId === instanceId) selectedInstanceId = null;
      selectedForGrouping.delete(instanceId);
      if (statblockOpenForId === instanceId) forceCloseStatblockPopover();

      // If this instance was a player mid-"awaiting initiative", drop that
      // tracking too -- otherwise its library row would keep showing the
      // confirm input, pointed at an instance that no longer exists.
      for (const [templateId, awaitingId] of awaitingInitiativeFor) {
        if (awaitingId === instanceId) {
          awaitingInitiativeFor.delete(templateId);
          break;
        }
      }
    });

    // Removing a player combatant changes hasPlayerInstance()'s answer for
    // its templateId, which the library row's Add/Added button state
    // depends on -- re-render the player tab so it flips back to an
    // active "Add" button immediately, not just after some other action
    // happens to trigger a re-render (or a full page reload).
    if (inst.sourceType === 'player') {
      renderPlayerResults();
    }
  }

  // -------------------------------------------------------------------
  // Top-level controls: turn order, new encounter, group init, export/import
  // -------------------------------------------------------------------

  function wireTopLevelControls() {
    el.tabMonsters.addEventListener('click', () => switchLibraryTab('monsters'));
    el.tabPlayers.addEventListener('click', () => switchLibraryTab('players'));

    el.addAllPlayersBtn.addEventListener('click', handleAddAllPlayers);
    el.reloadPlayersBtn.addEventListener('click', reloadPlayersFromStorage);

    el.undoBtn.addEventListener('click', performUndo);

    el.combatLogBtn.addEventListener('click', openCombatLogPanel);

    el.combatLogExportBtn.addEventListener('click', () => {
      const text = CombatLog.exportText();
      Storage.downloadText(text || 'Log je prázdný.', 'combat-log.txt');
    });

    el.backupBtn.addEventListener('click', () => {
      const backup = Storage.exportAllBackup();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      Storage.downloadJson(backup, `dnd-tracker-backup-${stamp}.json`);
    });

    el.restoreBtn.addEventListener('click', () => {
      el.restoreInput.click();
    });

    el.restoreInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      Storage.readJsonFile(file)
        .then((json) => {
          if (!json || json.format !== 'dnd-tracker-backup' || !json.data) {
            alert('Soubor nevypadá jako platná záloha DM Encounter Trackeru.');
            return;
          }
          if (!confirm('Nahradit aktuální data zálohou? Současný encounter, knihovny a log budou přepsány.')) {
            return;
          }
          Storage.importAllBackup(json);
          // Every module (MonsterLibrary, PlayerLibrary, SpellLibrary,
          // Encounter, CombatLog) already loaded its in-memory state at
          // page startup -- writing the restored data into localStorage
          // alone wouldn't update any of that. A full reload is the
          // simplest reliable way to make every module re-initialize
          // from the newly-restored data, the same way it does on any
          // normal page load.
          alert('Záloha byla obnovena. Stránka se nyní znovu načte.');
          location.reload();
        })
        .catch((err) => alert('Nepodařilo se přečíst soubor zálohy: ' + err))
        .finally(() => {
          el.restoreInput.value = '';
        });
    });

    el.playerViewBtn.addEventListener('click', () => {
      // window.open() with a named target reuses an existing window with
      // that same name if one is still open, rather than creating a new
      // one -- exactly what's needed so OBS's Window Capture (which is
      // bound to a specific window handle) doesn't need remapping every
      // time this button is clicked. The tracked reference lets us go
      // one step further and explicitly reload it (per the request: "in
      // case it's frozen") rather than just refocusing an existing tab.
      if (playerViewWindowRef && !playerViewWindowRef.closed) {
        reloadAndFocusPlayerView(playerViewWindowRef);
      } else {
        // playerViewWindowRef is null here either because this is the
        // first click ever, OR because the main tracker page itself was
        // reloaded (resetting this script's memory) while a player-view
        // window from an earlier session is still open. window.open()
        // with the same name finds that real window either way -- the
        // browser tracks window names independently of this variable --
        // but we still need to detect "found an existing one" vs "just
        // created a blank new one" to know whether to reload it.
        const opened = window.open('player-view.html', 'dnd-tracker-player-view', 'width=900,height=700');
        playerViewWindowRef = opened;
        let alreadyHadContent = false;
        try {
          alreadyHadContent = !!(opened && opened.location && opened.location.href && opened.location.href.includes('player-view.html'));
        } catch (e) {
          alreadyHadContent = false; // inaccessible -- treat as a fresh window, no reload needed
        }
        if (alreadyHadContent) {
          reloadAndFocusPlayerView(opened);
        }
      }

      // BroadcastChannel doesn't replay past messages to a listener that
      // subscribes after they were sent -- a freshly (re)loaded player-view
      // window would otherwise sit on its "waiting for connection" state
      // until the next encounter change. Re-send shortly after, giving
      // the window's script time to load and attach its listener first.
      setTimeout(broadcastPlayerView, 300);
    });

    // Bullet B: auto-reload when another tab/window (typically
    // player-editor.html) writes to the players localStorage key. The
    // 'storage' event only fires in OTHER tabs/windows, never the one
    // that made the write -- which is exactly right here, since this is
    // for picking up changes made elsewhere, not reacting to our own
    // writes from "Add All Players" etc.
    window.addEventListener('storage', (e) => {
      if (e.key === 'dnd-tracker:players') {
        reloadPlayersFromStorage();
      }
    });

    el.nextTurnBtn.addEventListener('click', () => {
      mutate(null, () => showTurnReminders(Encounter.nextTurn()));
    });

    el.prevTurnBtn.addEventListener('click', () => {
      mutate(null, () => Encounter.previousTurn());
    });

    el.nextRoundBtn.addEventListener('click', () => {
      mutate(null, () => showTurnReminders(Encounter.nextRound()));
    });

    el.newEncounterBtn.addEventListener('click', () => {
      if (confirm('Vytvořit nový encounter? Aktuální stav bude ztracen.')) {
        Encounter.reset();
        selectedInstanceId = null;
        selectedForGrouping.clear();
        awaitingInitiativeFor.clear();
        forceCloseStatblockPopover();
        // A fresh encounter has nothing to undo back to, and the combat
        // log is explicitly cleared together with the encounter per the
        // agreed behavior -- both reset here rather than going through
        // mutate(), which would otherwise snapshot the now-irrelevant
        // old state and log a spurious "encounter reset" entry into a
        // log that's about to be wiped anyway.
        undoStack = [];
        updateUndoButtonState();
        CombatLog.clear();
        Storage.saveCombatLog(CombatLog.getAll());
        persistAndRerenderEncounter();
        renderPlayerResults();
      }
    });

    // Roll Missing Initiative (renamed from the old Roll Initiative): only
    // ever rolls for initiativeMode === "auto" && initiativeRolled === false
    // combatants. See encounter.js rollMissingInitiative() for the actual
    // safety rail -- this button is just the trigger.
    el.rollInitiativeBtn.addEventListener('click', () => {
      mutate('Rolled missing initiative', () => Encounter.rollMissingInitiative());
    });

    el.groupSelectedBtn.addEventListener('click', () => {
      const names = Array.from(selectedForGrouping)
        .map((id) => Encounter.getInstance(id))
        .filter(Boolean)
        .map((i) => i.publicName || i.displayName);
      mutate(`Grouped: ${names.join(', ')}`, () => {
        Encounter.groupSelected(Array.from(selectedForGrouping));
        selectedForGrouping.clear();
      });
    });

    el.exportEncounterBtn.addEventListener('click', () => {
      Storage.downloadJson(Encounter.getState(), 'encounter.json');
    });

    el.importEncounterBtn.addEventListener('click', () => {
      el.importEncounterInput.click();
    });

    el.importEncounterInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      Storage.readJsonFile(file)
        .then((json) => {
          if (!json || !Array.isArray(json.instances)) {
            showImportStatus('Soubor neobsahuje platný encounter (chybí "instances").', 'error');
            return;
          }
          Encounter.setState(json);
          selectedInstanceId = null;
          awaitingInitiativeFor.clear();
          forceCloseStatblockPopover();
          undoStack = []; // undoing back to a pre-import state doesn't make sense
          updateUndoButtonState();
          persistAndRerenderEncounter();
          renderPlayerResults();
          showImportStatus('Encounter byl načten.', 'ok');
        })
        .catch((err) => showImportStatus(String(err), 'error'))
        .finally(() => {
          el.importEncounterInput.value = '';
        });
    });

    el.importLibraryBtn.addEventListener('click', () => {
      el.importLibraryInput.click();
    });

    el.importLibraryInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleLibraryImport(file);
      el.importLibraryInput.value = '';
    });

    el.searchInput.addEventListener('input', renderLibraryResults);

    // Floating stat block popover: pin/close/drag are wired by
    // DraggablePanel itself (created in cacheRefs). Only click-outside
    // needs handling here.

    // Click-outside-to-close: ignore clicks that originated on a ⓘ button
    // (those are handled by their own listener, which opens/repositions
    // the popover for a *different* combatant/template) or inside the
    // popover itself. Works the same whether the open popover is a live
    // encounter combatant or a library-template preview. Pinned popovers
    // are left alone -- requestClose() is a no-op while pinned.
    document.addEventListener('click', (e) => {
      if (!statblockOpenForId && !statblockOpenForTemplate) return;
      if (el.statblockPopover.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.statblock-info-btn')) return;
      closeStatblockPopover();
    });

    // Click-outside-to-close for the Combat Log panel, same pin-aware
    // pattern as the other floating panels.
    document.addEventListener('click', (e) => {
      if (el.combatLogPanel.style.display === 'none') return;
      if (el.combatLogPanel.contains(e.target)) return;
      if (e.target === el.combatLogBtn) return;
      combatLogPanel.requestClose();
    });
  }

  // -------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------

  function isTypingTarget(target) {
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function wireKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Escape: close an open floating stat block first -- but only if
      // it isn't pinned (pinned panels only close via their Close
      // button, per the agreed behavior). If it WAS open and unpinned,
      // closing it is the only thing this Escape press does. If it's
      // pinned (so nothing closed), or nothing was open, fall through to
      // the selection-clearing behavior below instead of doing nothing.
      if (e.key === 'Escape' && (statblockOpenForId || statblockOpenForTemplate) && !statblockPanel.isPinned()) {
        closeStatblockPopover();
        return;
      }

      // Same pattern for the Combat Log panel: Escape closes it unless pinned.
      if (e.key === 'Escape' && el.combatLogPanel.style.display !== 'none' && !combatLogPanel.isPinned()) {
        combatLogPanel.requestClose();
        return;
      }

      const typing = isTypingTarget(e.target);

      // Ctrl+Z (or Cmd+Z on Mac) triggers Undo, but only when NOT typing
      // in a text field -- inside an input/textarea, Ctrl+Z should do the
      // browser's normal text-edit undo, not the encounter-wide undo.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        performUndo();
        return;
      }

      // Ctrl+F or "/" focuses search, even while typing elsewhere (but not while
      // already typing in the search box itself, to avoid double-handling).
      if ((e.key === '/' && !typing) || (e.ctrlKey && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
        return;
      }

      if (typing) return; // all other shortcuts are suppressed while typing

      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        mutate(null, () => showTurnReminders(Encounter.nextTurn()));
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        mutate(null, () => Encounter.previousTurn());
      } else if (e.key.toLowerCase() === 'k') {
        if (selectedInstanceId) {
          e.preventDefault();
          const inst = Encounter.getInstance(selectedInstanceId);
          const name = inst ? (inst.publicName || inst.displayName) : 'Combatant';
          mutate(`${name} marked Dead`, () => Encounter.markDead(selectedInstanceId));
        }
      } else if (e.key === 'Delete') {
        if (selectedInstanceId) {
          e.preventDefault();
          requestRemoveInstance(selectedInstanceId);
        }
      } else if (e.key === 'Escape') {
        selectedInstanceId = null;
        selectedForGrouping.clear();
        document.activeElement.blur();
        renderEncounter();
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

  /**
   * Computes and applies app-layout's grid-template-columns as plain
   * pixel values in JS, recalculated on every resize via ResizeObserver.
   *
   * This REPLACES an earlier attempt to do the same thing in pure CSS
   * via calc(1.5fr - 16px) (with or without minmax() wrapping, with or
   * without a var()/calc() chain for the offset) -- every variant of
   * that approach caused the browser to reject the whole
   * grid-template-columns value as invalid, collapsing all three panels
   * into a single implicit column (which is why they started stacking
   * vertically instead of sitting side by side). Computing in JS and
   * writing only plain px numbers sidesteps that fr/calc interaction
   * entirely.
   *
   * The math: left and middle columns get their exact 1:3.5 proportional
   * share of the available width (matching what they'd get under the
   * original pure-fr CSS, before the icon rail ever grew), each clamped
   * to its own minimum. The right column gets whatever's left over --
   * so a wider icon rail (or a narrower window) only ever eats into the
   * right column's share, never redistributes proportionally across all
   * three the way plain fr units would.
   */
  function setupResponsiveColumnWidths() {
    const layoutEl = document.querySelector('.app-layout');
    if (!layoutEl) return;

    const LEFT_RATIO = 1;
    const MIDDLE_RATIO = 3.5;
    const RIGHT_RATIO = 1.5;
    const TOTAL_RATIO = LEFT_RATIO + MIDDLE_RATIO + RIGHT_RATIO;

    const LEFT_MIN = 220;
    const MIDDLE_MIN = 420;
    const RIGHT_MIN = 284;
    const GAP = 1; // matches .app-layout's gap: 1px, twice (two gaps between three columns)

    function recompute() {
      const available = layoutEl.getBoundingClientRect().width - GAP * 2;
      if (available <= 0) return;

      let left = Math.max(LEFT_MIN, available * (LEFT_RATIO / TOTAL_RATIO));
      let middle = Math.max(MIDDLE_MIN, available * (MIDDLE_RATIO / TOTAL_RATIO));
      let right = available - left - middle;

      // If squeezing left/middle to their proportional share already
      // leaves less than the right column's own minimum, there simply
      // isn't enough room to honor all three minimums at once -- clamp
      // right to its minimum and let it overflow/scroll rather than
      // producing a negative width.
      if (right < RIGHT_MIN) {
        right = RIGHT_MIN;
      }

      layoutEl.style.gridTemplateColumns = `${left}px ${middle}px ${right}px`;
    }

    recompute();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(recompute).observe(layoutEl);
    } else {
      // Extremely old browsers only -- falls back to window resize,
      // which won't catch layout-only width changes (e.g. the icon
      // rail itself resizing without the window resizing), but covers
      // the common case and avoids throwing on load.
      window.addEventListener('resize', recompute);
    }
  }

  function init() {
    cacheRefs();
    wireTopLevelControls();
    wireKeyboardShortcuts();
    renderLibraryResults();
    renderPlayerResults();
    renderEncounter();
    updateUndoButtonState();
    setupResponsiveColumnWidths();

    const savedLog = Storage.loadCombatLog();
    if (Array.isArray(savedLog)) {
      CombatLog.setAll(savedLog);
    }
  }

  return { init, renderEncounter, renderLibraryResults, renderPlayerResults };
})();
