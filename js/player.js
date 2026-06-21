/**
 * player.js
 * -----------------------------------------------------------------------
 * Owns the PlayerTemplate library: bundled sample PCs, persistence via
 * Storage, and lookup. Deliberately mirrors data.js's MonsterLibrary
 * shape/pattern so the two libraries stay easy to reason about side by
 * side -- this is a DM combat reference, not a full character sheet.
 *
 * PlayerTemplate shape (informal):
 * {
 *   id, name, className, level,
 *   armorClass, maxHp, currentHp, tempHp,
 *   initiativeBonus, speed,
 *   abilities: { str, dex, con, int, wis, cha },
 *   savingThrows: { str, dex, con, int, wis, cha },
 *   skills: { [skillName]: number },
 *   passivePerception, passiveInsight, passiveInvestigation,
 *   senses, notes, importantAbilities: [{name, text}],
 *
 *   -- Editor metadata (bullet G): the player-editor.html form needs these
 *   -- to reopen a player and recompute things correctly, rather than only
 *   -- ever seeing the final computed numbers above.
 *   saveProficiencies: { str, dex, con, int, wis, cha } (booleans),
 *   saveMiscBonuses: { str, dex, con, int, wis, cha } (numbers),
 *   initiativeMiscBonus: number,
 *   passiveSkillSettings: {
 *     perception: { mode: "none"|"proficient"|"expertise"|"override", misc, override },
 *     insight: { ... },
 *     investigation: { ... },
 *   }
 * }
 *
 * Note: currentHp/tempHp live on the template too (so the library can
 * show "HP 38/44" at a glance), but the encounter's CombatantInstance
 * always gets its own copy on add -- editing HP mid-fight never mutates
 * the library entry. Syncing a live combatant from an updated template
 * is a deliberate, explicit action (Encounter.syncPlayerFromTemplate),
 * never automatic.
 * -----------------------------------------------------------------------
 */

const PlayerLibrary = (() => {
  let templates = new Map();

  const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  function isValidTemplate(p) {
    if (!p || typeof p !== 'object') return false;
    if (typeof p.id !== 'string' || !p.id.trim()) return false;
    if (typeof p.name !== 'string' || !p.name.trim()) return false;
    return true;
  }

  /** Fills in a {str,dex,con,int,wis,cha} object with a default for any
   *  missing ability key, without disturbing keys that are already present. */
  function withAbilityDefaults(obj, defaultValue) {
    const result = {};
    ABILITY_KEYS.forEach((k) => {
      result[k] = obj && obj[k] !== undefined ? obj[k] : defaultValue;
    });
    return result;
  }

  /** D&D ability modifier from a raw score, e.g. 16 -> +3. Local copy so
   *  player.js has no dependency on ui.js's helpers. */
  function abilityMod(score) {
    if (!Number.isFinite(score)) return 0;
    return Math.floor((score - 10) / 2);
  }

  /**
   * Normalizes/migrates a raw player object (from sample JSON, an older
   * localStorage save, or an imported file) into the current full
   * PlayerTemplate shape, per bullet H's exact fallback rules:
   *
   *   - saveProficiencies missing -> false for every ability
   *   - saveMiscBonuses missing   -> 0 for every ability
   *   - initiativeMiscBonus missing -> initiativeBonus - DEX modifier
   *     (back-derived so a re-save without touching anything reproduces
   *     the same initiativeBonus the player already had)
   *   - passiveSkillSettings missing -> each passive skill set to mode
   *     "override" with the currently-saved passive value, so re-saving
   *     without changes reproduces the same passive scores
   *   - currentHp missing -> maxHp
   *   - tempHp missing -> 0
   *   - importantAbilities missing -> []
   *
   * Old savingThrows/passive values themselves are NOT recomputed here --
   * bullet H is explicit that the editor must stay tolerant of old data
   * until the user re-saves the form, at which point player-editor.js
   * recomputes everything from the input fields.
   */
  function normalizeTemplate(raw) {
    const abilities = withAbilityDefaults(raw.abilities, 10);
    const maxHp = Number.isFinite(raw.maxHp) ? raw.maxHp : 1;

    const saveProficiencies = withAbilityDefaults(raw.saveProficiencies, false);
    const saveMiscBonuses = withAbilityDefaults(raw.saveMiscBonuses, 0);

    let initiativeBonus = Number.isFinite(raw.initiativeBonus) ? raw.initiativeBonus : 0;
    let initiativeMiscBonus = raw.initiativeMiscBonus;
    if (!Number.isFinite(initiativeMiscBonus)) {
      // Back-derive from the existing initiativeBonus so nothing changes
      // on a no-op re-save: initiativeBonus = dexMod + initiativeMiscBonus.
      initiativeMiscBonus = initiativeBonus - abilityMod(abilities.dex);
    }

    const passivePerception = Number.isFinite(raw.passivePerception) ? raw.passivePerception : 10;
    const passiveInsight = Number.isFinite(raw.passiveInsight) ? raw.passiveInsight : null;
    const passiveInvestigation = Number.isFinite(raw.passiveInvestigation) ? raw.passiveInvestigation : null;

    let passiveSkillSettings = raw.passiveSkillSettings;
    if (!passiveSkillSettings || typeof passiveSkillSettings !== 'object') {
      // No structured settings on record -- treat each known passive value
      // as a manual override so re-opening the form shows the same numbers
      // the player already had, rather than silently recalculating them.
      passiveSkillSettings = {
        perception: { mode: 'override', misc: 0, override: passivePerception },
        insight: { mode: 'override', misc: 0, override: passiveInsight != null ? passiveInsight : 10 },
        investigation: { mode: 'override', misc: 0, override: passiveInvestigation != null ? passiveInvestigation : 10 },
      };
    } else {
      // Even if present, make sure all three keys exist with sane shapes.
      ['perception', 'insight', 'investigation'].forEach((key) => {
        const s = passiveSkillSettings[key];
        if (!s || typeof s !== 'object') {
          passiveSkillSettings[key] = { mode: 'none', misc: 0, override: null };
        } else {
          if (!['none', 'proficient', 'expertise', 'override'].includes(s.mode)) s.mode = 'none';
          if (!Number.isFinite(s.misc)) s.misc = 0;
          if (s.override !== null && !Number.isFinite(s.override)) s.override = null;
        }
      });
    }

    return {
      id: raw.id,
      name: raw.name,
      className: raw.className || 'Adventurer',
      level: Number.isFinite(raw.level) ? raw.level : 1,
      armorClass: Number.isFinite(raw.armorClass) ? raw.armorClass : 10,
      maxHp,
      currentHp: Number.isFinite(raw.currentHp) ? raw.currentHp : maxHp,
      tempHp: Number.isFinite(raw.tempHp) ? raw.tempHp : 0,
      initiativeBonus,
      speed: raw.speed || '30 ft.',
      abilities,
      saveProficiencies,
      saveMiscBonuses,
      savingThrows: raw.savingThrows || {},
      initiativeMiscBonus,
      skills: raw.skills || {},
      passiveSkillSettings,
      passivePerception,
      passiveInsight,
      passiveInvestigation,
      senses: raw.senses || '',
      notes: raw.notes || '',
      importantAbilities: Array.isArray(raw.importantAbilities) ? raw.importantAbilities : [],
    };
  }

  /**
   * Loads templates from a parsed JSON object into the library.
   * @param {object} json - expected shape: { players: [...] }
   * @param {boolean} replace - if true, clears the library first
   */
  function loadFromJson(json, replace) {
    if (replace) templates.clear();

    const list = Array.isArray(json) ? json : json && Array.isArray(json.players)
      ? json.players
      : null;

    if (!list) {
      return { added: 0, skipped: 0, errors: ['JSON musí obsahovat pole "players" nebo být přímo pole hráčů.'] };
    }

    let added = 0;
    let skipped = 0;
    const errors = [];

    list.forEach((entry, idx) => {
      if (!isValidTemplate(entry)) {
        skipped++;
        errors.push(`Položka #${idx + 1} byla přeskočena (chybí "id" nebo "name").`);
        return;
      }
      templates.set(entry.id, normalizeTemplate(entry));
      added++;
    });

    return { added, skipped, errors };
  }

  function getAll() {
    return Array.from(templates.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function getById(id) {
    return templates.get(id) || null;
  }

  /** True if a template with this id is already in the library. Used by
   *  makeUniqueIdFromName() to find a free slot, and by the editor to
   *  distinguish "new player" from "editing an existing one". */
  function exists(id) {
    return templates.has(id);
  }

  /** Inserts or replaces a template in the library (normalizing first),
   *  keyed by its id. This is the only write path the editor uses --
   *  callers are responsible for calling Storage.savePlayers(getAll())
   *  afterwards to persist the change (bullet I explicitly keeps that
   *  step in player-editor.js rather than implicit here, so the editor
   *  stays in full control of when a save actually hits localStorage). */
  function addOrUpdate(playerTemplate) {
    const normalized = normalizeTemplate(playerTemplate);
    templates.set(normalized.id, normalized);
    return normalized;
  }

  function remove(id) {
    templates.delete(id);
  }

  /**
   * Slugifies a display name into a stable id, e.g. "Aeris Vael" ->
   * "aeris-vael". If that slug is already taken, appends "-2", "-3", etc.
   * until a free one is found. Used only when CREATING a new player --
   * per bullet D, an existing player's id never changes automatically,
   * even if its name is edited later (the encounter may already reference
   * that id as a CombatantInstance's templateId).
   */
  function makeUniqueIdFromName(name) {
    const base = String(name || 'player')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics (Žápal -> zapal-safe)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'player';

    if (!exists(base)) return base;

    let n = 2;
    while (exists(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  /** Returns the full library as a { players: [...] } object, ready for
   *  JSON.stringify and download (bullet J's Export Players JSON). */
  function exportJson() {
    return { players: getAll() };
  }

  return {
    loadFromJson,
    getAll,
    getById,
    exists,
    addOrUpdate,
    remove,
    makeUniqueIdFromName,
    normalizeTemplate,
    exportJson,
  };
})();
