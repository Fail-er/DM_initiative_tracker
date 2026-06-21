/**
 * player-editor.js
 * -----------------------------------------------------------------------
 * Standalone Player Manager page. Lets the DM create, edit, duplicate,
 * and delete PlayerTemplates, with input-driven computation of derived
 * stats (saves, initiative bonus, passive skills) per bullet F.
 *
 * This file owns ALL of the form's computed-value logic. encounter.js/
 * ui.js never recompute these -- they only ever read the final stored
 * values (savingThrows, initiativeBonus, passivePerception, etc.) off a
 * PlayerTemplate, exactly as before. This keeps the tracker itself
 * unchanged: as far as it's concerned, a player template just has those
 * fields populated, however they got there.
 * -----------------------------------------------------------------------
 */

const PlayerEditor = (() => {
  const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const ABILITY_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
  const PASSIVE_SKILLS = [
    { key: 'perception', label: 'Perception', abilityKey: 'wis' },
    { key: 'insight', label: 'Insight', abilityKey: 'wis' },
    { key: 'investigation', label: 'Investigation', abilityKey: 'int' },
  ];

  // The template currently loaded into the form, in full editor-shape
  // (including saveProficiencies/saveMiscBonuses/initiativeMiscBonus/
  // passiveSkillSettings). null when no player is selected ("Nový hráč"
  // before first save also lives here, with no id assigned yet).
  let current = null;
  // Snapshot of `current` as it was when first loaded/created, used by
  // "Zrušit změny" to discard in-progress edits without reloading from
  // the library (which would lose a not-yet-saved brand new player).
  let loadedSnapshot = null;
  // Tracks whether `current` represents a NEW player (not yet saved under
  // any id) vs an existing one being edited. Affects how Save assigns id.
  let isNewPlayer = false;

  let el = {};

  function cacheRefs() {
    el = {
      playerList: document.getElementById('player-list'),
      newPlayerBtn: document.getElementById('new-player-btn'),
      importStatus: document.getElementById('import-status'),

      emptyState: document.getElementById('editor-empty-state'),
      form: document.getElementById('player-form'),

      saveBtn: document.getElementById('save-player-btn'),
      saveCopyBtn: document.getElementById('save-copy-btn'),
      deleteBtn: document.getElementById('delete-player-btn'),
      revertBtn: document.getElementById('revert-player-btn'),

      exportBtn: document.getElementById('export-players-btn'),
      importBtn: document.getElementById('import-players-btn'),
      importInput: document.getElementById('import-players-input'),

      name: document.getElementById('f-name'),
      className: document.getElementById('f-className'),
      level: document.getElementById('f-level'),
      armorClass: document.getElementById('f-armorClass'),
      maxHp: document.getElementById('f-maxHp'),
      currentHp: document.getElementById('f-currentHp'),
      tempHp: document.getElementById('f-tempHp'),
      speed: document.getElementById('f-speed'),
      senses: document.getElementById('f-senses'),
      idDisplay: document.getElementById('f-id-display'),

      abilityGrid: document.getElementById('ability-grid'),
      saveGrid: document.getElementById('save-grid'),

      initiativeMisc: document.getElementById('f-initiativeMisc'),
      computedInitiative: document.getElementById('computed-initiative'),

      passiveGrid: document.getElementById('passive-grid'),

      abilitiesList: document.getElementById('abilities-list'),
      addAbilityBtn: document.getElementById('add-ability-btn'),

      notes: document.getElementById('f-notes'),
    };
  }

  // -------------------------------------------------------------------
  // Computation helpers (bullet F)
  // -------------------------------------------------------------------

  function abilityMod(score) {
    if (!Number.isFinite(score)) return 0;
    return Math.floor((score - 10) / 2);
  }

  function fmtMod(n) {
    return n >= 0 ? `+${n}` : `${n}`;
  }

  /** D&D 5e standard proficiency-bonus-by-level table. */
  function proficiencyBonusForLevel(level) {
    const lvl = Number.isFinite(level) ? level : 1;
    if (lvl >= 17) return 6;
    if (lvl >= 13) return 5;
    if (lvl >= 9) return 4;
    if (lvl >= 5) return 3;
    return 2;
  }

  function computeSave(abilityScore, proficient, miscBonus, proficiencyBonus) {
    const mod = abilityMod(abilityScore);
    const prof = proficient ? proficiencyBonus : 0;
    const misc = Number.isFinite(miscBonus) ? miscBonus : 0;
    return mod + prof + misc;
  }

  function computeInitiativeBonus(dexScore, initiativeMiscBonus) {
    const misc = Number.isFinite(initiativeMiscBonus) ? initiativeMiscBonus : 0;
    return abilityMod(dexScore) + misc;
  }

  /**
   * Computes a single passive skill score per bullet F's mode table:
   *   none       -> +0 proficiency
   *   proficient -> +proficiencyBonus
   *   expertise  -> +2 x proficiencyBonus
   *   override   -> ignore the formula entirely, use the manual value
   * passive = 10 + abilityMod + proficiencyComponent + misc (unless override)
   */
  function computePassive(abilityScore, settings, proficiencyBonus) {
    if (!settings) settings = { mode: 'none', misc: 0, override: null };
    if (settings.mode === 'override') {
      return Number.isFinite(settings.override) ? settings.override : 10;
    }
    const mod = abilityMod(abilityScore);
    let profComponent = 0;
    if (settings.mode === 'proficient') profComponent = proficiencyBonus;
    else if (settings.mode === 'expertise') profComponent = proficiencyBonus * 2;
    const misc = Number.isFinite(settings.misc) ? settings.misc : 0;
    return 10 + mod + profComponent + misc;
  }

  // -------------------------------------------------------------------
  // LEFT PANEL: player list
  // -------------------------------------------------------------------

  function renderPlayerList() {
    const players = PlayerLibrary.getAll();
    el.playerList.innerHTML = '';

    if (!players.length) {
      el.playerList.innerHTML = '<p class="empty-hint">Žádní hráči. Vytvoř nového.</p>';
      return;
    }

    players.forEach((p) => {
      const row = document.createElement('div');
      const isSelected = current && !isNewPlayer && current.id === p.id;
      row.className = 'monster-row player-list-row' + (isSelected ? ' player-list-row-selected' : '');
      row.innerHTML = `
        <div class="monster-row-info">
          <span class="monster-row-name">${escapeHtml(p.name)}</span>
          <span class="monster-row-meta">${escapeHtml(p.className)} ${p.level} &middot; AC ${p.armorClass} &middot; HP ${p.maxHp}</span>
        </div>
      `;
      row.addEventListener('click', () => loadPlayerIntoForm(p));
      el.playerList.appendChild(row);
    });
  }

  // -------------------------------------------------------------------
  // Form: loading data in
  // -------------------------------------------------------------------

  function blankPlayer() {
    return {
      id: null, // assigned on first save
      name: '',
      className: 'Adventurer',
      level: 1,
      armorClass: 10,
      maxHp: 10,
      currentHp: 10,
      tempHp: 0,
      speed: '30 ft.',
      senses: '',
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      saveProficiencies: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
      saveMiscBonuses: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      savingThrows: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      initiativeMiscBonus: 0,
      initiativeBonus: 0,
      skills: {},
      passiveSkillSettings: {
        perception: { mode: 'none', misc: 0, override: null },
        insight: { mode: 'none', misc: 0, override: null },
        investigation: { mode: 'none', misc: 0, override: null },
      },
      passivePerception: 10,
      passiveInsight: 10,
      passiveInvestigation: 10,
      notes: '',
      importantAbilities: [],
    };
  }

  function startNewPlayer() {
    current = blankPlayer();
    isNewPlayer = true;
    loadedSnapshot = deepClone(current);
    renderForm();
    renderPlayerList();
    el.name.focus();
  }

  function loadPlayerIntoForm(template) {
    // Re-normalize through the library so the form always works from a
    // fully-shaped object, even if the stored template predates some field.
    current = deepClone(PlayerLibrary.normalizeTemplate(template));
    isNewPlayer = false;
    loadedSnapshot = deepClone(current);
    renderForm();
    renderPlayerList();
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // -------------------------------------------------------------------
  // Form: rendering
  // -------------------------------------------------------------------

  function renderForm() {
    if (!current) {
      el.emptyState.style.display = '';
      el.form.style.display = 'none';
      return;
    }
    el.emptyState.style.display = 'none';
    el.form.style.display = '';

    el.name.value = current.name;
    el.className.value = current.className;
    el.level.value = current.level;
    el.armorClass.value = current.armorClass;
    el.maxHp.value = current.maxHp;
    el.currentHp.value = current.currentHp;
    el.tempHp.value = current.tempHp;
    el.speed.value = current.speed;
    el.senses.value = current.senses;
    el.idDisplay.textContent = current.id || '(přidělí se při uložení)';
    el.initiativeMisc.value = current.initiativeMiscBonus;
    el.notes.value = current.notes;

    // Delete only makes sense for an already-saved player.
    el.deleteBtn.disabled = isNewPlayer;

    renderAbilityGrid();
    renderSaveGrid();
    renderPassiveGrid();
    renderAbilitiesList();
    recomputeAll();
  }

  function renderAbilityGrid() {
    el.abilityGrid.innerHTML = ABILITY_KEYS.map((key) => `
      <label class="form-field ability-field">
        ${ABILITY_LABELS[key]}
        <div class="ability-input-row">
          <input type="number" id="ability-${key}" value="${current.abilities[key]}" data-ability="${key}" />
          <span class="ability-mod-readout" id="ability-mod-${key}">${fmtMod(abilityMod(current.abilities[key]))}</span>
        </div>
      </label>
    `).join('');

    ABILITY_KEYS.forEach((key) => {
      document.getElementById(`ability-${key}`).addEventListener('input', (e) => {
        current.abilities[key] = parseInt(e.target.value, 10) || 0;
        recomputeAll();
      });
    });
  }

  function renderSaveGrid() {
    el.saveGrid.innerHTML = ABILITY_KEYS.map((key) => `
      <div class="save-row">
        <label class="save-row-checkbox">
          <input type="checkbox" id="save-prof-${key}" ${current.saveProficiencies[key] ? 'checked' : ''} />
          ${ABILITY_LABELS[key]} save proficient
        </label>
        <label class="save-row-misc">
          misc
          <input type="number" id="save-misc-${key}" value="${current.saveMiscBonuses[key]}" />
        </label>
        <span class="save-row-readout" id="save-readout-${key}">+0</span>
      </div>
    `).join('');

    ABILITY_KEYS.forEach((key) => {
      document.getElementById(`save-prof-${key}`).addEventListener('change', (e) => {
        current.saveProficiencies[key] = e.target.checked;
        recomputeAll();
      });
      document.getElementById(`save-misc-${key}`).addEventListener('input', (e) => {
        current.saveMiscBonuses[key] = parseInt(e.target.value, 10) || 0;
        recomputeAll();
      });
    });
  }

  function renderPassiveGrid() {
    el.passiveGrid.innerHTML = PASSIVE_SKILLS.map(({ key, label }) => {
      const s = current.passiveSkillSettings[key];
      return `
        <div class="passive-row">
          <span class="passive-row-label">${label}</span>
          <select id="passive-mode-${key}" class="passive-mode-select">
            <option value="none" ${s.mode === 'none' ? 'selected' : ''}>none</option>
            <option value="proficient" ${s.mode === 'proficient' ? 'selected' : ''}>proficient</option>
            <option value="expertise" ${s.mode === 'expertise' ? 'selected' : ''}>expertise</option>
            <option value="override" ${s.mode === 'override' ? 'selected' : ''}>override</option>
          </select>
          <label class="passive-misc-field">misc
            <input type="number" id="passive-misc-${key}" value="${s.misc}" ${s.mode === 'override' ? 'disabled' : ''} />
          </label>
          <label class="passive-override-field">override
            <input type="number" id="passive-override-${key}" value="${s.override != null ? s.override : ''}" ${s.mode !== 'override' ? 'disabled' : ''} />
          </label>
          <span class="passive-row-readout" id="passive-readout-${key}">10</span>
        </div>
      `;
    }).join('');

    PASSIVE_SKILLS.forEach(({ key }) => {
      document.getElementById(`passive-mode-${key}`).addEventListener('change', (e) => {
        current.passiveSkillSettings[key].mode = e.target.value;
        renderPassiveGrid(); // re-render to enable/disable misc vs override inputs
        recomputeAll();
      });
      document.getElementById(`passive-misc-${key}`).addEventListener('input', (e) => {
        current.passiveSkillSettings[key].misc = parseInt(e.target.value, 10) || 0;
        recomputeAll();
      });
      document.getElementById(`passive-override-${key}`).addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        current.passiveSkillSettings[key].override = Number.isFinite(v) ? v : null;
        recomputeAll();
      });
    });
  }

  function renderAbilitiesList() {
    el.abilitiesList.innerHTML = current.importantAbilities.map((a, idx) => `
      <div class="important-ability-row" data-idx="${idx}">
        <input type="text" class="ability-name-input" placeholder="Name (e.g. Rage)" value="${escapeAttr(a.name)}" />
        <input type="text" class="ability-text-input" placeholder="Text" value="${escapeAttr(a.text)}" />
        <button type="button" class="btn btn-small btn-danger ability-remove-btn" aria-label="Odebrat schopnost">&times;</button>
      </div>
    `).join('') || '<p class="empty-hint-inline">Žádné schopnosti.</p>';

    el.abilitiesList.querySelectorAll('.important-ability-row').forEach((row) => {
      const idx = parseInt(row.dataset.idx, 10);
      row.querySelector('.ability-name-input').addEventListener('input', (e) => {
        current.importantAbilities[idx].name = e.target.value;
      });
      row.querySelector('.ability-text-input').addEventListener('input', (e) => {
        current.importantAbilities[idx].text = e.target.value;
      });
      row.querySelector('.ability-remove-btn').addEventListener('click', () => {
        current.importantAbilities.splice(idx, 1);
        renderAbilitiesList();
      });
    });
  }

  // -------------------------------------------------------------------
  // Recompute derived values and update all the small readouts.
  // Called on every relevant input change -- cheap enough given the
  // tiny amount of data involved.
  // -------------------------------------------------------------------

  function recomputeAll() {
    const profBonus = proficiencyBonusForLevel(current.level);

    ABILITY_KEYS.forEach((key) => {
      const modEl = document.getElementById(`ability-mod-${key}`);
      if (modEl) modEl.textContent = fmtMod(abilityMod(current.abilities[key]));

      const save = computeSave(current.abilities[key], current.saveProficiencies[key], current.saveMiscBonuses[key], profBonus);
      const readout = document.getElementById(`save-readout-${key}`);
      if (readout) readout.textContent = fmtMod(save);
    });

    const initBonus = computeInitiativeBonus(current.abilities.dex, current.initiativeMiscBonus);
    el.computedInitiative.textContent = fmtMod(initBonus);

    PASSIVE_SKILLS.forEach(({ key, abilityKey }) => {
      const settings = current.passiveSkillSettings[key];
      const passive = computePassive(current.abilities[abilityKey], settings, profBonus);
      const readout = document.getElementById(`passive-readout-${key}`);
      if (readout) readout.textContent = String(passive);
    });
  }

  // -------------------------------------------------------------------
  // Pulling form values back into `current` before save (covers basic
  // fields not already live-bound via input listeners above).
  // -------------------------------------------------------------------

  function syncBasicFieldsFromForm() {
    current.name = el.name.value.trim();
    current.className = el.className.value.trim() || 'Adventurer';
    current.level = parseInt(el.level.value, 10) || 1;
    current.armorClass = parseInt(el.armorClass.value, 10) || 10;
    current.maxHp = parseInt(el.maxHp.value, 10) || 1;
    current.currentHp = parseInt(el.currentHp.value, 10);
    if (!Number.isFinite(current.currentHp)) current.currentHp = current.maxHp;
    current.tempHp = parseInt(el.tempHp.value, 10) || 0;
    current.speed = el.speed.value.trim() || '30 ft.';
    current.senses = el.senses.value.trim();
    current.initiativeMiscBonus = parseInt(el.initiativeMisc.value, 10) || 0;
    current.notes = el.notes.value;
  }

  /** Recomputes every derived/stored value from the current input state,
   *  exactly mirroring recomputeAll()'s formulas, and writes the results
   *  into current.savingThrows / current.initiativeBonus / passive*
   *  fields -- these are what actually get persisted and what the rest
   *  of the tracker reads. Per bullet H: this only happens on save, not
   *  continuously, so an old player's stale savingThrows survive untouched
   *  until the DM explicitly re-saves the form. */
  function commitComputedValues() {
    const profBonus = proficiencyBonusForLevel(current.level);

    const savingThrows = {};
    ABILITY_KEYS.forEach((key) => {
      savingThrows[key] = computeSave(current.abilities[key], current.saveProficiencies[key], current.saveMiscBonuses[key], profBonus);
    });
    current.savingThrows = savingThrows;

    current.initiativeBonus = computeInitiativeBonus(current.abilities.dex, current.initiativeMiscBonus);

    PASSIVE_SKILLS.forEach(({ key, abilityKey }) => {
      const settings = current.passiveSkillSettings[key];
      const passive = computePassive(current.abilities[abilityKey], settings, profBonus);
      if (key === 'perception') current.passivePerception = passive;
      else if (key === 'insight') current.passiveInsight = passive;
      else if (key === 'investigation') current.passiveInvestigation = passive;
    });
  }

  // -------------------------------------------------------------------
  // Save / Save as copy / Delete / Revert
  // -------------------------------------------------------------------

  function validateForm() {
    if (!el.name.value.trim()) {
      alert('Jméno hráče je povinné.');
      el.name.focus();
      return false;
    }
    return true;
  }

  function handleSave() {
    if (!validateForm()) return;
    syncBasicFieldsFromForm();
    commitComputedValues();

    if (isNewPlayer) {
      // Bullet D: id is generated from the name ONLY on first save of a
      // brand new player, with -2/-3 suffixing on collision.
      current.id = PlayerLibrary.makeUniqueIdFromName(current.name);
    }
    // Existing players: id is left exactly as-is, even if name changed --
    // it must stay stable since the encounter may reference it.

    PlayerLibrary.addOrUpdate(current);
    persistLibrary();

    isNewPlayer = false;
    loadedSnapshot = deepClone(current);
    renderForm();
    renderPlayerList();
    showImportStatus(`Hráč "${current.name}" uložen.`, 'ok');
  }

  function handleSaveAsCopy() {
    if (!validateForm()) return;
    syncBasicFieldsFromForm();
    commitComputedValues();

    // Always mints a fresh id off the (possibly edited) name, regardless
    // of whether the original had an id -- "copy" always means "new entry".
    const copy = deepClone(current);
    copy.id = PlayerLibrary.makeUniqueIdFromName(current.name);

    PlayerLibrary.addOrUpdate(copy);
    persistLibrary();

    current = copy;
    isNewPlayer = false;
    loadedSnapshot = deepClone(current);
    renderForm();
    renderPlayerList();
    showImportStatus(`Vytvořena kopie jako "${copy.id}".`, 'ok');
  }

  function handleDelete() {
    if (isNewPlayer || !current || !current.id) return;
    if (!confirm(`Smazat hráče "${current.name}" z knihovny? Tuto akci nelze vrátit zpět.`)) return;

    PlayerLibrary.remove(current.id);
    persistLibrary();

    current = null;
    loadedSnapshot = null;
    renderForm();
    renderPlayerList();
    showImportStatus('Hráč byl smazán.', 'ok');
  }

  function handleRevert() {
    if (!loadedSnapshot) return;
    current = deepClone(loadedSnapshot);
    renderForm();
    showImportStatus('Změny byly zrušeny.', 'ok');
  }

  function persistLibrary() {
    Storage.savePlayers(PlayerLibrary.getAll());
  }

  // -------------------------------------------------------------------
  // Important Abilities: add row
  // -------------------------------------------------------------------

  function handleAddAbility() {
    current.importantAbilities.push({ name: '', text: '' });
    renderAbilitiesList();
  }

  // -------------------------------------------------------------------
  // Import / Export (bullet J)
  // -------------------------------------------------------------------

  function handleExport() {
    Storage.downloadJson(PlayerLibrary.exportJson(), 'players.json');
  }

  function handleImportFile(file) {
    Storage.readJsonFile(file)
      .then((json) => {
        const replace = confirm('Nahradit současné hráče importem? OK = nahradit, Cancel = doplnit k existujícím.');
        const result = PlayerLibrary.loadFromJson(json, replace);
        persistLibrary();
        renderPlayerList();
        current = null;
        renderForm();
        if (result.errors.length) {
          showImportStatus(`Načteno ${result.added} hráčů, ${result.skipped} přeskočeno. ${result.errors[0]}`, 'warn');
        } else {
          showImportStatus(`Načteno ${result.added} hráčů.`, 'ok');
        }
      })
      .catch((err) => showImportStatus(String(err), 'error'));
  }

  function showImportStatus(message, kind) {
    el.importStatus.textContent = message;
    el.importStatus.className = 'import-status import-status-' + kind;
    el.importStatus.style.display = 'block';
    clearTimeout(showImportStatus._t);
    showImportStatus._t = setTimeout(() => {
      el.importStatus.style.display = 'none';
    }, 4000);
  }

  // -------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  // -------------------------------------------------------------------
  // Wiring + init
  // -------------------------------------------------------------------

  function wireEvents() {
    el.newPlayerBtn.addEventListener('click', startNewPlayer);
    el.saveBtn.addEventListener('click', handleSave);
    el.saveCopyBtn.addEventListener('click', handleSaveAsCopy);
    el.deleteBtn.addEventListener('click', handleDelete);
    el.revertBtn.addEventListener('click', handleRevert);
    el.addAbilityBtn.addEventListener('click', handleAddAbility);

    el.exportBtn.addEventListener('click', handleExport);
    el.importBtn.addEventListener('click', () => el.importInput.click());
    el.importInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleImportFile(file);
      el.importInput.value = '';
    });

    // Basic-field inputs don't need live recompute hooks (they don't feed
    // any readout directly), but level DOES affect every save/passive
    // readout via the proficiency bonus, so it needs its own recompute hook.
    el.level.addEventListener('input', () => {
      current.level = parseInt(el.level.value, 10) || 1;
      recomputeAll();
    });
  }

  function init() {
    cacheRefs();
    wireEvents();

    const saved = Storage.loadPlayers();
    if (saved && Array.isArray(saved.players) && saved.players.length) {
      PlayerLibrary.loadFromJson(saved, true);
    }
    // If localStorage has no players yet, the library simply starts empty
    // here -- player-editor.html intentionally does NOT bundle its own
    // copy of the sample players; that bootstrap lives in app.js/index.html.
    // Opening the editor before ever opening the tracker once will show an
    // empty list, which is an acceptable MVP edge case.

    renderPlayerList();
    renderForm();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', PlayerEditor.init);
