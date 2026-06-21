/**
 * data.js
 * -----------------------------------------------------------------------
 * Owns the MonsterTemplate library: loading the bundled sample set,
 * importing user JSON files, validating shape, and searching/filtering.
 *
 * MonsterTemplate shape (informal):
 * {
 *   id, name, source, type,
 *   armorClass, hitPoints, initiativeBonus, speed, challengeRating,
 *   abilities: { str, dex, con, int, wis, cha },
 *   saves: { [ability]: number },
 *   skills: { [skillName]: number },
 *   resistances: [string], immunities: [string],
 *   senses, traits: [{name, text}], actions: [{name, text}]
 * }
 * -----------------------------------------------------------------------
 */

const MonsterLibrary = (() => {
  // In-memory library, keyed by template id for fast lookup.
  let templates = new Map();

  /** Returns true if the object looks enough like a MonsterTemplate to use. */
  function isValidTemplate(t) {
    if (!t || typeof t !== 'object') return false;
    if (typeof t.id !== 'string' || !t.id.trim()) return false;
    if (typeof t.name !== 'string' || !t.name.trim()) return false;
    // Everything else is treated as optional / defaulted, so the importer
    // stays forgiving of partial data rather than rejecting whole files.
    return true;
  }

  /** Fills in safe defaults so the rest of the app never has to null-check. */
  function normalizeTemplate(raw) {
    return {
      id: raw.id,
      name: raw.name,
      source: raw.source || 'Custom',
      type: raw.type || 'Unknown',
      armorClass: Number.isFinite(raw.armorClass) ? raw.armorClass : 10,
      hitPoints: Number.isFinite(raw.hitPoints) ? raw.hitPoints : 1,
      initiativeBonus: Number.isFinite(raw.initiativeBonus) ? raw.initiativeBonus : 0,
      speed: raw.speed || '30 ft.',
      challengeRating: raw.challengeRating != null ? String(raw.challengeRating) : '0',
      abilities: raw.abilities || {},
      saves: raw.saves || {},
      skills: raw.skills || {},
      resistances: Array.isArray(raw.resistances) ? raw.resistances : [],
      immunities: Array.isArray(raw.immunities) ? raw.immunities : [],
      senses: raw.senses || '',
      traits: Array.isArray(raw.traits) ? raw.traits : [],
      actions: Array.isArray(raw.actions) ? raw.actions : [],
    };
  }

  /**
   * Loads templates from a parsed JSON object into the library.
   * @param {object} json - expected shape: { monsters: [...] }
   * @param {boolean} replace - if true, clears the library first
   * @returns {{added: number, skipped: number, errors: string[]}}
   */
  function loadFromJson(json, replace) {
    if (replace) templates.clear();

    const list = Array.isArray(json) ? json : json && Array.isArray(json.monsters)
      ? json.monsters
      : null;

    if (!list) {
      return { added: 0, skipped: 0, errors: ['JSON musí obsahovat pole "monsters" nebo být přímo pole monster.'] };
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
    return Array.from(templates.values());
  }

  function getById(id) {
    return templates.get(id) || null;
  }

  /**
   * Real-time search across name / type / challengeRating / source.
   * Case-insensitive substring match, OR'd across fields.
   */
  function search(query) {
    const q = (query || '').trim().toLowerCase();
    const all = getAll();
    if (!q) return all.sort((a, b) => a.name.localeCompare(b.name));

    return all
      .filter((t) => {
        return (
          t.name.toLowerCase().includes(q) ||
          t.type.toLowerCase().includes(q) ||
          String(t.challengeRating).toLowerCase().includes(q) ||
          t.source.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return { loadFromJson, getAll, getById, search };
})();
