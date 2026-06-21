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
 *   senses, notes, importantAbilities: [{name, text}]
 * }
 *
 * Note: currentHp/tempHp live on the template too (so the library can
 * show "HP 38/44" at a glance), but the encounter's CombatantInstance
 * always gets its own copy on add -- editing HP mid-fight never mutates
 * the library entry.
 * -----------------------------------------------------------------------
 */

const PlayerLibrary = (() => {
  let templates = new Map();

  function isValidTemplate(p) {
    if (!p || typeof p !== 'object') return false;
    if (typeof p.id !== 'string' || !p.id.trim()) return false;
    if (typeof p.name !== 'string' || !p.name.trim()) return false;
    return true;
  }

  function normalizeTemplate(raw) {
    const maxHp = Number.isFinite(raw.maxHp) ? raw.maxHp : 1;
    return {
      id: raw.id,
      name: raw.name,
      className: raw.className || 'Adventurer',
      level: Number.isFinite(raw.level) ? raw.level : 1,
      armorClass: Number.isFinite(raw.armorClass) ? raw.armorClass : 10,
      maxHp,
      currentHp: Number.isFinite(raw.currentHp) ? raw.currentHp : maxHp,
      tempHp: Number.isFinite(raw.tempHp) ? raw.tempHp : 0,
      initiativeBonus: Number.isFinite(raw.initiativeBonus) ? raw.initiativeBonus : 0,
      speed: raw.speed || '30 ft.',
      abilities: raw.abilities || {},
      savingThrows: raw.savingThrows || {},
      skills: raw.skills || {},
      passivePerception: Number.isFinite(raw.passivePerception) ? raw.passivePerception : 10,
      passiveInsight: Number.isFinite(raw.passiveInsight) ? raw.passiveInsight : null,
      passiveInvestigation: Number.isFinite(raw.passiveInvestigation) ? raw.passiveInvestigation : null,
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

  return { loadFromJson, getAll, getById };
})();
