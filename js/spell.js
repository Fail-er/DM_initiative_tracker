/**
 * spell.js
 * -----------------------------------------------------------------------
 * Owns the SpellLibrary: bundled sample spells, persistence via Storage,
 * lookup, and a simple search index. Mirrors data.js's MonsterLibrary and
 * player.js's PlayerLibrary pattern -- this is a quick DM reference, not
 * a spell-slot/casting tracker (the encounter never holds spells; see
 * spell-ui.js for the header search + floating card that's all this
 * feature is).
 *
 * SpellTemplate shape:
 * {
 *   id, name, source, level, school,
 *   castingTime, range, components, duration,
 *   concentration, ritual,
 *   classes: [string],
 *   save: string|null, attackType: string|null,
 *   damageTypes: [string], conditions: [string],
 *   area: string|null,
 *   entries: [string], higherLevel: string|null
 * }
 *
 * Import also accepts raw 5etools spell JSON ({ spell: [...] } or a bare
 * array). That format is structurally very different -- school is a
 * single-letter code, range/duration/time are nested objects, ritual and
 * concentration are buried inside `meta`/`duration[0]`, and text uses the
 * same {@tag ...} markup as the bestiary format -- so it's auto-detected
 * and run through a dedicated parser before being normalized into the
 * shape above. See the chat investigation of a real spells-phb.json
 * export for the exact shapes handled here; the bundled 5etools file we
 * inspected has NO `classes` field at all (5etools usually splits
 * class-to-spell mappings into a separate file), so imported spells from
 * that kind of export simply get classes: [] -- this is expected, not a
 * parsing failure.
 * -----------------------------------------------------------------------
 */

const SpellLibrary = (() => {
  let templates = new Map();
  // Lightweight search index: id -> lowercased blob of every searchable
  // field, rebuilt whenever the library changes. Search is then just a
  // substring test against this blob per bullet H ("simple case-
  // insensitive substring search" is explicitly enough for an MVP).
  let searchBlobs = new Map();

  function isValidTemplate(s) {
    if (!s || typeof s !== 'object') return false;
    if (typeof s.id !== 'string' || !s.id.trim()) return false;
    if (typeof s.name !== 'string' || !s.name.trim()) return false;
    return true;
  }

  /** Fills in safe defaults so the rest of the app never has to null-check. */
  function normalizeTemplate(raw) {
    return {
      id: raw.id,
      name: raw.name,
      source: raw.source || 'Custom',
      level: Number.isFinite(raw.level) ? raw.level : 0,
      school: raw.school || 'Unknown',
      castingTime: raw.castingTime || '1 action',
      range: raw.range || '',
      components: raw.components || '',
      duration: raw.duration || '',
      concentration: !!raw.concentration,
      ritual: !!raw.ritual,
      classes: Array.isArray(raw.classes) ? raw.classes : [],
      save: raw.save || null,
      attackType: raw.attackType || null,
      damageTypes: Array.isArray(raw.damageTypes) ? raw.damageTypes : [],
      conditions: Array.isArray(raw.conditions) ? raw.conditions : [],
      area: raw.area || null,
      entries: Array.isArray(raw.entries) ? raw.entries : [],
      higherLevel: raw.higherLevel || null,
    };
  }

  // -------------------------------------------------------------------
  // Search index (bullet H)
  // -------------------------------------------------------------------

  /** Builds the lowercased searchable text blob for one spell, covering
   *  every field bullet H lists: name, level, school, castingTime,
   *  range, duration, concentration, ritual, classes, save, attackType,
   *  damageTypes, conditions, source, entries text, higherLevel text.
   *  "lvl 3" / "level 2" style queries work because both the bare number
   *  and a "level N" / "lvl N" phrase are included explicitly. */
  function buildSearchBlob(spell) {
    const parts = [
      spell.name,
      `level ${spell.level}`,
      `lvl ${spell.level}`,
      spell.school,
      spell.castingTime,
      spell.range,
      spell.duration,
      spell.concentration ? 'concentration' : '',
      spell.ritual ? 'ritual' : '',
      ...spell.classes,
      spell.save ? `${spell.save} save` : '',
      spell.attackType || '',
      ...spell.damageTypes,
      ...spell.conditions,
      spell.source,
      spell.entries.join(' '),
      spell.higherLevel || '',
    ];
    return parts.filter(Boolean).join(' | ').toLowerCase();
  }

  function reindex(spell) {
    searchBlobs.set(spell.id, buildSearchBlob(spell));
  }

  /**
   * Case-insensitive substring search across every field in
   * buildSearchBlob. Results are ranked in two tiers: spells whose NAME
   * contains the query come first, followed by spells that only match
   * elsewhere (school, range, entries text, etc). Within each tier,
   * results stay alphabetical -- they're filtered from getAll()'s
   * already-sorted list, and Array.filter preserves relative order, so
   * no separate sort step is needed here.
   *
   * An empty query returns everything (alphabetical, no ranking needed
   * since there's nothing to rank against). Callers -- the header search
   * overlay -- are the ones enforcing the "3+ characters" display rule
   * from bullet A, not the library itself.
   */
  function search(query) {
    const q = (query || '').trim().toLowerCase();
    const all = getAll();
    if (!q) return all;

    const nameMatches = [];
    const otherMatches = [];
    all.forEach((s) => {
      const blob = searchBlobs.get(s.id) || '';
      if (!blob.includes(q)) return;
      if (s.name.toLowerCase().includes(q)) {
        nameMatches.push(s);
      } else {
        otherMatches.push(s);
      }
    });

    return [...nameMatches, ...otherMatches];
  }

  // -------------------------------------------------------------------
  // 5etools import: format detection
  // -------------------------------------------------------------------

  /**
   * Detects whether parsed JSON looks like a 5etools spell export rather
   * than this app's native { spells: [...] } format. 5etools spell
   * entries have a distinctive shape that never overlaps with ours --
   * school as a single letter, range/duration/time as nested objects --
   * checking a couple of these on the first entry is enough to tell the
   * formats apart reliably.
   */
  function isFiveToolsFormat(json) {
    const list = Array.isArray(json) ? json
      : json && Array.isArray(json.spell) ? json.spell
      : null;
    if (!list || !list.length) return false;

    const sample = list[0];
    if (!sample || typeof sample !== 'object') return false;

    const schoolLooksLikeFiveTools = typeof sample.school === 'string' && sample.school.length === 1;
    const rangeLooksLikeFiveTools = sample.range && typeof sample.range === 'object' && 'type' in sample.range;
    const timeLooksLikeFiveTools = Array.isArray(sample.time) &&
      sample.time.length > 0 && typeof sample.time[0] === 'object';
    const durationLooksLikeFiveTools = Array.isArray(sample.duration) &&
      sample.duration.length > 0 && typeof sample.duration[0] === 'object';

    const signals = [schoolLooksLikeFiveTools, rangeLooksLikeFiveTools, timeLooksLikeFiveTools, durationLooksLikeFiveTools];
    return signals.filter(Boolean).length >= 2;
  }

  // -------------------------------------------------------------------
  // 5etools import: {@tag ...} markup cleanup
  // -------------------------------------------------------------------

  /** Same approach as data.js's cleanFiveToolsTags -- kept as an
   *  independent copy rather than a shared import, since this app has no
   *  module/bundler system and each file is meant to stand alone when
   *  loaded as a plain <script> tag. Handles the tags that actually show
   *  up in spell entries (damage/dice/conditions/DCs/cross-references),
   *  with a generic fallback for anything else pipe-delimited. */
  function cleanFiveToolsTags(text) {
    if (typeof text !== 'string') return '';
    let result = text;

    result = result.replace(/\{@damage ([^}]+)\}/g, '$1');
    result = result.replace(/\{@dice ([^}]+)\}/g, '$1');
    result = result.replace(/\{@scaledamage ([^|}]+)\|[^|}]+\|([^}]+)\}/g, '$1 (+$2 per slot level)');
    result = result.replace(/\{@dc (\d+)\}/g, 'DC $1');
    result = result.replace(/\{@condition ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@status ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@skill ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@action ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@spell ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@creature ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@sense ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@book ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@quickref ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@note ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@filter ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@hit (-?\d+)\}/g, (_, n) => (n >= 0 ? `+${n}` : n));

    // Generic fallback for any remaining {@tag content|extra}, run
    // repeatedly until stable: a NESTED tag like "{@note text {@filter
    // x|y} more text}" can't be fully cleaned in one pass, since the
    // first regex match stops at the first "}" it finds (the inner
    // tag's), leaving the outer "{@note" unresolved. Looping until no
    // {@...} pattern remains handles arbitrary nesting depth without
    // needing a real parser for what is, in practice, only ever one or
    // two levels deep in actual spell text.
    let previous;
    do {
      previous = result;
      result = result.replace(/\{@\w+ ([^|}]+)(\|[^}]*)?\}/g, '$1');
      result = result.replace(/\{@\w+\}/g, '');
    } while (result !== previous);

    return result.trim();
  }

  function joinFiveToolsEntries(entries) {
    if (!Array.isArray(entries)) return [];
    const out = [];
    entries.forEach((e) => {
      if (typeof e === 'string') {
        out.push(cleanFiveToolsTags(e));
      } else if (e && typeof e === 'object' && Array.isArray(e.entries)) {
        // Nested {type:"entries", name, entries:[...]} blocks (used by
        // entriesHigherLevel, and occasionally within entries itself) --
        // flatten recursively rather than modeling the structure.
        out.push(...joinFiveToolsEntries(e.entries));
      }
    });
    return out;
  }

  // -------------------------------------------------------------------
  // 5etools import: field-by-field parsing helpers
  // -------------------------------------------------------------------

  const SCHOOL_CODES = {
    A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment',
    V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation',
  };

  function parseFiveToolsSchool(code) {
    return SCHOOL_CODES[code] || code || 'Unknown';
  }

  /** time is an array of {number, unit, condition?}. Cast spells almost
   *  always have exactly one entry; joined just in case of rare
   *  multi-option cases. condition (used by reactions, e.g. "which you
   *  take when...") is folded in parenthetically since it's genuinely
   *  useful at-a-glance context for a reaction spell. */
  function parseFiveToolsTime(time) {
    if (!Array.isArray(time) || !time.length) return '1 action';
    return time.map((t) => {
      const base = `${t.number} ${t.unit}${t.number > 1 ? 's' : ''}`;
      return t.condition ? `${base} (${cleanFiveToolsTags(t.condition)})` : base;
    }).join(' or ');
  }

  /** range is {type, distance: {type, amount?}}. type "point" is a normal
   *  ranged target; other types (cone/sphere/line/cube/etc) mean the
   *  spell is self-centered on that shape -- handled by deriving `area`
   *  from this same object (see parseFiveToolsArea below) rather than
   *  duplicating the shape name into both range and area. */
  function parseFiveToolsRange(range) {
    if (!range || typeof range !== 'object') return '';
    const dist = range.distance;
    if (!dist) return range.type || '';

    if (dist.type === 'self') return 'Self';
    if (dist.type === 'touch') return 'Touch';
    if (dist.type === 'sight') return 'Sight';
    if (dist.type === 'unlimited') return 'Unlimited';

    const unit = dist.type === 'feet' ? 'ft.' : dist.type === 'miles' ? 'mi.' : (dist.type || '');
    const amount = Number.isFinite(dist.amount) ? dist.amount : '';

    // Non-point range types ARE the area shape, centered on/from the
    // caster (e.g. range.type "cone" + distance 15 ft -> "Self (15-foot cone)").
    if (range.type && range.type !== 'point') {
      return `Self (${amount} ${unit} ${range.type})`.replace(/\s+/g, ' ').trim();
    }
    return `${amount} ${unit}`.trim();
  }

  /** Derives the `area` field from the same range object, for spells
   *  whose range.type is a shape rather than "point" (cone, sphere,
   *  line, cube, radius, hemisphere). Returns null for ordinary
   *  point-targeted or self/touch spells with no inherent area. */
  function parseFiveToolsArea(range) {
    if (!range || typeof range !== 'object') return null;
    if (!range.type || range.type === 'point') return null;
    const dist = range.distance;
    if (!dist || !Number.isFinite(dist.amount)) return range.type;
    const unit = dist.type === 'feet' ? 'foot' : dist.type === 'miles' ? 'mile' : (dist.type || '');
    return `${dist.amount}-${unit} ${range.type}`;
  }

  /** components is {v, s, m} where m can be `true` or a descriptive
   *  string (material component details). Rendered as the classic
   *  "V, S, M (a sprinkling of holy water)" short form. */
  function parseFiveToolsComponents(components) {
    if (!components || typeof components !== 'object') return '';
    const parts = [];
    if (components.v) parts.push('V');
    if (components.s) parts.push('S');
    if (components.m) {
      parts.push(typeof components.m === 'string' ? `M (${cleanFiveToolsTags(components.m)})` : 'M');
    }
    return parts.join(', ');
  }

  /** duration is an array of {type, duration?: {type, amount}, concentration?}.
   *  type "instant"/"permanent"/"special" need no further detail; "timed"
   *  has a nested amount+unit. Concentration is detected here too (used
   *  separately by parseFiveToolsConcentration) since it lives on this
   *  same object, not as a top-level field. */
  function parseFiveToolsDuration(duration) {
    if (!Array.isArray(duration) || !duration.length) return '';
    return duration.map((d) => {
      if (d.type === 'instant') return 'Instantaneous';
      if (d.type === 'permanent') return 'Until dispelled';
      if (d.type === 'special') return 'Special';
      if (d.type === 'timed' && d.duration) {
        const amt = d.duration.amount;
        const unit = d.duration.type;
        return `${d.concentration ? 'Concentration, up to ' : ''}${amt} ${unit}${amt > 1 ? 's' : ''}`;
      }
      return d.type || '';
    }).join(' or ');
  }

  function parseFiveToolsConcentration(duration) {
    return Array.isArray(duration) && duration.some((d) => d.concentration === true);
  }

  /** savingThrow is an array of full lowercase ability names
   *  ("dexterity"). We only need one for a quick-reference save field --
   *  multi-save spells are rare enough that the first is a fine MVP
   *  simplification -- rendered as the standard 3-letter abbreviation. */
  function parseFiveToolsSave(savingThrow) {
    if (!Array.isArray(savingThrow) || !savingThrow.length) return null;
    return savingThrow[0].slice(0, 3).toUpperCase();
  }

  /** spellAttack is an array of single-letter codes: "M" (melee), "R"
   *  (ranged), "O" (other/unknown in some entries). Rendered as a short
   *  readable label. */
  function parseFiveToolsAttackType(spellAttack) {
    if (!Array.isArray(spellAttack) || !spellAttack.length) return null;
    const code = spellAttack[0];
    if (code === 'M') return 'Melee';
    if (code === 'R') return 'Ranged';
    return code;
  }

  // -------------------------------------------------------------------
  // 5etools import: top-level spell parser
  // -------------------------------------------------------------------

  /** id generation: slugify "name-source", deduped against the library
   *  the same way monster/player ids are. Re-importing the same spell
   *  (same name + source) reuses its existing id and overwrites it,
   *  rather than piling up "-2" suffixes -- same fix as the bestiary
   *  importer needed after the first round of testing there. */
  function makeIdFromNameAndSource(name, source) {
    const base = `${name}-${source || ''}`
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'spell';

    const existingAtBase = templates.get(base);
    const isSameSpell = existingAtBase && existingAtBase.name === name && existingAtBase.source === source;
    if (!existingAtBase || isSameSpell) return base;

    let n = 2;
    while (true) {
      const candidate = `${base}-${n}`;
      const existingAtCandidate = templates.get(candidate);
      if (!existingAtCandidate) return candidate;
      if (existingAtCandidate.name === name && existingAtCandidate.source === source) return candidate;
      n++;
    }
  }

  /** Parses a single 5etools spell entry into this app's SpellTemplate
   *  shape. Returns null if too malformed to use (missing a name).
   *  Note: `classes` is intentionally left as [] here -- the 5etools
   *  spell-list export format we've seen doesn't carry class-to-spell
   *  mappings inline (5etools usually splits that into a separate
   *  class data file), so there's nothing reliable to parse it from. */
  function parseFiveToolsSpell(raw) {
    if (!raw || !raw.name) return null;

    const entries = joinFiveToolsEntries(raw.entries);

    let higherLevel = null;
    if (Array.isArray(raw.entriesHigherLevel)) {
      const hlText = joinFiveToolsEntries(raw.entriesHigherLevel);
      if (hlText.length) higherLevel = hlText.join(' ');
    }

    return {
      id: makeIdFromNameAndSource(raw.name, raw.source),
      name: raw.name,
      source: raw.source || 'Custom',
      level: Number.isFinite(raw.level) ? raw.level : 0,
      school: parseFiveToolsSchool(raw.school),
      castingTime: parseFiveToolsTime(raw.time),
      range: parseFiveToolsRange(raw.range),
      components: parseFiveToolsComponents(raw.components),
      duration: parseFiveToolsDuration(raw.duration),
      concentration: parseFiveToolsConcentration(raw.duration),
      ritual: !!(raw.meta && raw.meta.ritual),
      classes: [], // see docstring above -- not present in this export format
      save: parseFiveToolsSave(raw.savingThrow),
      attackType: parseFiveToolsAttackType(raw.spellAttack),
      damageTypes: Array.isArray(raw.damageInflict) ? raw.damageInflict : [],
      conditions: Array.isArray(raw.conditionInflict) ? raw.conditionInflict : [],
      area: parseFiveToolsArea(raw.range),
      entries,
      higherLevel,
    };
  }

  /** Parses an entire 5etools spell JSON ({spell: [...]} or a bare array)
   *  into { added, skipped, errors }, inserting parsed spells directly
   *  into the library and (re)building each one's search blob. */
  function loadFromFiveToolsJson(json) {
    const list = Array.isArray(json) ? json : json.spell;
    let added = 0;
    let skipped = 0;
    const errors = [];

    list.forEach((raw, idx) => {
      let parsed = null;
      try {
        parsed = parseFiveToolsSpell(raw);
      } catch (e) {
        parsed = null;
      }
      if (!parsed) {
        skipped++;
        errors.push(`Položka #${idx + 1} (${raw && raw.name ? raw.name : 'bez jména'}) se nepodařilo naparsovat z 5etools formátu.`);
        return;
      }
      templates.set(parsed.id, parsed);
      reindex(parsed);
      added++;
    });

    return { added, skipped, errors };
  }

  /**
   * Loads templates from a parsed JSON object into the library.
   * Auto-detects 5etools spell format vs this app's native
   * { spells: [...] } format and routes to the appropriate parser.
   * @param {object} json - either { spells: [...] } (native) or a
   *        5etools spell export ({ spell: [...] } or a bare array)
   * @param {boolean} replace - if true, clears the library first
   * @returns {{added: number, skipped: number, errors: string[]}}
   */
  function loadFromJson(json, replace) {
    if (replace) {
      templates.clear();
      searchBlobs.clear();
    }

    if (isFiveToolsFormat(json)) {
      return loadFromFiveToolsJson(json);
    }

    const list = Array.isArray(json) ? json : json && Array.isArray(json.spells)
      ? json.spells
      : null;

    if (!list) {
      return { added: 0, skipped: 0, errors: ['JSON musí obsahovat pole "spells" nebo být přímo pole kouzel.'] };
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
      const normalized = normalizeTemplate(entry);
      templates.set(normalized.id, normalized);
      reindex(normalized);
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

  /** Returns the full library as a { spells: [...] } object, for
   *  Export-style use elsewhere if ever needed (mirrors PlayerLibrary's
   *  exportJson, kept for symmetry even though bullet list doesn't ask
   *  for spell export explicitly). */
  function exportJson() {
    return { spells: getAll() };
  }

  return { loadFromJson, getAll, getById, search, exportJson };
})();
