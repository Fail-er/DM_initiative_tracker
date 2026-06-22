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
 *
 * Import also accepts raw 5e.tools / 5etools bestiary JSON (the format
 * used by sites like 5e.tools for official sourcebook data). That format
 * is structurally very different -- nested AC/HP objects, dice formulas,
 * markdown-like {@tag ...} markup in text, and separate action/bonus/
 * reaction/legendary sections -- so it's auto-detected and run through a
 * dedicated parser (see the "5e.tools import" section below) before being
 * normalized into the shape above. Bonus actions, reactions, and legendary
 * actions all fold into the single `actions` list with a "[Bonus]" /
 * "[Reaction]" / "[Legendary]" name prefix, since MonsterTemplate has no
 * separate fields for them (a deliberate MVP simplification -- see chat).
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

  // -------------------------------------------------------------------
  // 5e.tools import: format detection
  // -------------------------------------------------------------------

  /**
   * Detects whether a parsed JSON object/array looks like a 5e.tools
   * bestiary export rather than this app's native { monsters: [...] }
   * format. 5e.tools monster entries have a very distinctive shape that
   * never overlaps with ours -- hp as {average, formula}, ac as an array
   * (of numbers or {ac, from} objects), and trait/action entries that
   * use "entries" arrays instead of a flat "text" string. Checking a
   * couple of these on the first entry is enough to tell the formats
   * apart reliably without false-positiving on a native export.
   */
  function isFiveToolsFormat(json) {
    const list = Array.isArray(json) ? json
      : json && Array.isArray(json.monster) ? json.monster
      : null;
    if (!list || !list.length) return false;

    const sample = list[0];
    if (!sample || typeof sample !== 'object') return false;

    const hpLooksLikeFiveTools = sample.hp && typeof sample.hp === 'object' && 'average' in sample.hp;
    const acLooksLikeFiveTools = Array.isArray(sample.ac);
    const traitLooksLikeFiveTools = Array.isArray(sample.trait) &&
      sample.trait.length > 0 && Array.isArray(sample.trait[0].entries);
    const actionLooksLikeFiveTools = Array.isArray(sample.action) &&
      sample.action.length > 0 && Array.isArray(sample.action[0].entries);

    // Require at least two independent signals to agree, so a native file
    // that happens to share one field name by coincidence isn't misread.
    const signals = [hpLooksLikeFiveTools, acLooksLikeFiveTools, traitLooksLikeFiveTools, actionLooksLikeFiveTools];
    return signals.filter(Boolean).length >= 2;
  }

  // -------------------------------------------------------------------
  // 5e.tools import: {@tag ...} markup cleanup
  // -------------------------------------------------------------------

  /**
   * 5e.tools text entries use a markdown-like {@tag content} syntax for
   * cross-references and computed values (damage dice, DCs, conditions,
   * skill/item links, etc). For a DM-reference tool we just want plain
   * readable text, so every tag is stripped down to its human-readable
   * content. Handles the tags that actually show up in monster stat
   * blocks; anything unrecognized falls back to just keeping the first
   * pipe-separated segment of its content, which covers the vast
   * majority of reference-style tags ({@item leather armor|phb} -> 
   * "leather armor") without needing a tag-by-tag list.
   */
  function cleanFiveToolsTags(text) {
    if (typeof text !== 'string') return '';
    let result = text;

    // Tags with bespoke human-readable output.
    result = result.replace(/\{@atk mw\}/g, 'Melee Weapon Attack:');
    result = result.replace(/\{@atk rw\}/g, 'Ranged Weapon Attack:');
    result = result.replace(/\{@atk mw,rw\}/g, 'Melee or Ranged Weapon Attack:');
    result = result.replace(/\{@h\}/g, 'Hit: ');
    result = result.replace(/\{@hit (-?\d+)\}/g, (_, n) => (n >= 0 ? `+${n}` : n));
    result = result.replace(/\{@dc (\d+)\}/g, 'DC $1');
    result = result.replace(/\{@damage ([^}]+)\}/g, '$1');
    result = result.replace(/\{@dice ([^}]+)\}/g, '$1');
    result = result.replace(/\{@recharge (\d+)\}/g, '(Recharge $1-6)');
    result = result.replace(/\{@recharge\}/g, '(Recharge 6)');
    result = result.replace(/\{@condition ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@status ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@skill ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@action ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@spell ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@sense ([^|}]+)(\|[^}]*)?\}/g, '$1');
    result = result.replace(/\{@quickref ([^|}]+)(\|[^}]*)?\}/g, '$1');

    // Generic fallback for any remaining {@tag content|extra|stuff} --
    // keep only the first segment before any '|', and drop the tag itself.
    // This covers {@item x|phb}, {@creature x|mm}, {@variantrule x|...},
    // and anything else without needing an exhaustive tag list.
    result = result.replace(/\{@\w+ ([^|}]+)(\|[^}]*)?\}/g, '$1');

    // Any tag with no space (rare, e.g. {@b} for bold) -- just drop braces/tag.
    result = result.replace(/\{@\w+\}/g, '');

    return result.trim();
  }

  /** Joins a 5e.tools "entries" array into a single text block. Entries
   *  are usually an array of strings, but can occasionally nest further
   *  structured objects (e.g. tables) -- those are rare in core monster
   *  stat blocks and are skipped rather than guessed at, keeping this
   *  parser focused on the common case rather than growing a full
   *  5e.tools rendering engine. */
  function joinFiveToolsEntries(entries) {
    if (!Array.isArray(entries)) return '';
    return entries
      .filter((e) => typeof e === 'string')
      .map(cleanFiveToolsTags)
      .join(' ');
  }

  // -------------------------------------------------------------------
  // 5e.tools import: field-by-field parsing helpers
  // -------------------------------------------------------------------

  /** ac is an array of either plain numbers or {ac, from, condition?}
   *  objects (e.g. a different AC while raging). We only need a single
   *  representative number for the quick-reference combat tracker, so
   *  take the first entry's value and ignore the armor-source breakdown
   *  and any conditional alternates. */
  function parseFiveToolsAc(ac) {
    if (!Array.isArray(ac) || !ac.length) return 10;
    const first = ac[0];
    if (typeof first === 'number') return first;
    if (first && typeof first === 'object' && Number.isFinite(first.ac)) return first.ac;
    return 10;
  }

  /** hp is {average, formula}. We use the average and drop the dice
   *  formula -- this app doesn't roll HP, it just tracks a starting pool. */
  function parseFiveToolsHp(hp) {
    if (hp && typeof hp === 'object' && Number.isFinite(hp.average)) return hp.average;
    if (Number.isFinite(hp)) return hp; // defensive: some custom entries might be a bare number
    return 1;
  }

  /** speed is {walk, fly, swim, climb, burrow, ...} (numbers, in feet),
   *  occasionally with a `canHover` flag on fly. Rendered as a single
   *  "30 ft., fly 80 ft." style string to match this app's plain-string
   *  speed field. */
  function parseFiveToolsSpeed(speed) {
    if (!speed || typeof speed !== 'object') return '30 ft.';
    const parts = [];
    if (Number.isFinite(speed.walk)) parts.push(`${speed.walk} ft.`);
    ['fly', 'swim', 'climb', 'burrow'].forEach((mode) => {
      if (Number.isFinite(speed[mode])) {
        parts.push(`${mode} ${speed[mode]} ft.${mode === 'fly' && speed.canHover ? ' (hover)' : ''}`);
      }
    });
    return parts.length ? parts.join(', ') : '30 ft.';
  }

  /** type is either a plain string ("dragon") or {type, tags: [...]}
   *  (e.g. {type: "humanoid", tags: ["goblinoid"]}). Tags are folded in
   *  parenthetically since they're useful context (e.g. "humanoid
   *  (goblinoid)") but the app's `type` field is just a display string. */
  function parseFiveToolsType(type) {
    if (typeof type === 'string') return type;
    if (type && typeof type === 'object') {
      const base = type.type || 'Unknown';
      if (Array.isArray(type.tags) && type.tags.length) {
        const tagNames = type.tags.map((t) => (typeof t === 'string' ? t : t.tag || '')).filter(Boolean);
        if (tagNames.length) return `${base} (${tagNames.join(', ')})`;
      }
      return base;
    }
    return 'Unknown';
  }

  /** cr is either a plain string/number, or {cr, lair} for monsters with
   *  a different (usually higher) CR while in their lair. We use the
   *  base `cr` value and drop the lair variant -- a quick-reference
   *  tracker doesn't need to track lair state. */
  function parseFiveToolsCr(cr) {
    if (cr && typeof cr === 'object' && cr.cr != null) return String(cr.cr);
    if (cr != null) return String(cr);
    return '0';
  }

  /** save/skill are {abilityOrSkillName: "+N"} maps with the bonus as a
   *  formatted string (always a plain +N/-N in this dataset; see chat
   *  investigation). Parsed into plain numbers, keyed the same way our
   *  `saves`/`skills` objects already expect (saves by 3-letter ability
   *  key, skills by display name). */
  function parseFiveToolsBonusMap(map, keyTransform) {
    const result = {};
    if (!map || typeof map !== 'object') return result;
    Object.entries(map).forEach(([key, value]) => {
      const n = parseInt(String(value).replace(/[^\d-]/g, ''), 10);
      if (!Number.isFinite(n)) return;
      const outKey = keyTransform ? keyTransform(key) : key;
      result[outKey] = n;
    });
    return result;
  }

  /** Capitalizes a skill key like "sleightOfHand" -> "Sleight Of Hand"
   *  for nicer display, matching the casual title-case style our own
   *  sample data already uses for skill names. */
  function titleCaseSkillName(key) {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
  }

  /** resist/immune/vulnerable entries are a mixed array: plain damage-type
   *  strings, OR nested {resist: [...], note, cond} objects used for
   *  conditional resistances (e.g. "bludgeoning, piercing, slashing from
   *  nonmagical attacks"). Flattened into a single list of display
   *  strings -- conditional entries get their note appended in
   *  parentheses so the condition isn't silently lost. */
  function parseFiveToolsDamageList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    list.forEach((entry) => {
      if (typeof entry === 'string') {
        out.push(entry);
      } else if (entry && typeof entry === 'object') {
        const inner = entry.resist || entry.immune || entry.vulnerable || [];
        const innerStr = Array.isArray(inner) ? inner.join(', ') : String(inner);
        if (innerStr) {
          out.push(entry.note ? `${innerStr} (${entry.note})` : innerStr);
        }
      }
    });
    return out;
  }

  /** senses is an array of plain strings ("darkvision 60 ft."), already
   *  close to our desired format -- just joined with a comma. */
  function parseFiveToolsSenses(senses) {
    if (!Array.isArray(senses)) return '';
    return senses.join(', ');
  }

  /** Converts a 5e.tools trait/action-style entry ({name, entries: [...]})
   *  into this app's {name, text} shape, joining and cleaning the entries
   *  text. An optional namePrefix (e.g. "[Legendary]") is prepended to
   *  the name -- used to fold bonus/reaction/legendary sections into the
   *  single `actions` list (see file header for why). */
  function parseFiveToolsNamedEntry(entry, namePrefix) {
    const cleanedName = cleanFiveToolsTags(entry.name || '');
    const name = namePrefix ? `${namePrefix} ${cleanedName}`.trim() : cleanedName;
    return { name, text: joinFiveToolsEntries(entry.entries) };
  }

  /** Spellcasting blocks have their own rich structure (spell slots by
   *  level, prepared/known lists, save DC, etc). Rather than modeling
   *  that fully -- which MonsterTemplate has no fields for, and which
   *  would push this well past a quick-reference MVP -- it's folded into
   *  a single readable trait: the header text (spellcasting ability,
   *  save DC, hit bonus) plus a flattened "Cantrips: ..., 1st level
   *  (4 slots): ..." summary. Good enough to read off at the table; not
   *  a substitute for the full spell list in the book. */
  function parseFiveToolsSpellcasting(spellcastingArr) {
    if (!Array.isArray(spellcastingArr) || !spellcastingArr.length) return null;
    const block = spellcastingArr[0];
    const header = joinFiveToolsEntries(block.headerEntries);
    const lines = [header];

    if (block.spells && typeof block.spells === 'object') {
      Object.keys(block.spells)
        .sort((a, b) => Number(a) - Number(b))
        .forEach((level) => {
          const levelData = block.spells[level];
          const spellNames = (levelData.spells || []).map(cleanFiveToolsTags).join(', ');
          if (!spellNames) return;
          const label = level === '0' ? 'Cantrips' : `Level ${level}${levelData.slots ? ` (${levelData.slots} slots)` : ''}`;
          lines.push(`${label}: ${spellNames}`);
        });
    }
    // Some entries use `will`/`daily` casting (innate spellcasters) instead
    // of leveled slots -- fold those in too if present.
    if (Array.isArray(block.will) && block.will.length) {
      lines.push(`At will: ${block.will.map(cleanFiveToolsTags).join(', ')}`);
    }
    if (block.daily && typeof block.daily === 'object') {
      Object.entries(block.daily).forEach(([freq, spells]) => {
        const spellNames = (Array.isArray(spells) ? spells : []).map(cleanFiveToolsTags).join(', ');
        if (spellNames) lines.push(`${freq}/day each: ${spellNames}`);
      });
    }

    return { name: 'Spellcasting', text: lines.filter(Boolean).join(' ') };
  }

  // -------------------------------------------------------------------
  // 5e.tools import: top-level monster parser
  // -------------------------------------------------------------------

  /** id generation for imported 5e.tools monsters: slugify "name (source)"
   *  so reprints / variants across different books don't collide (e.g.
   *  "Goblin" from MM vs a hypothetical reprint elsewhere both staying
   *  distinct). Mirrors the slugify approach used for players.
   *
   *  Re-importing the SAME monster (same name + source) intentionally
   *  reuses its existing id rather than minting a "-2" suffix, so
   *  re-importing a bestiary (or importing an updated version of one)
   *  overwrites the existing entries instead of piling up duplicates.
   *  The "-2"/"-3" suffixing only kicks in when a genuinely different
   *  monster happens to slugify to an already-taken base id. */
  function makeIdFromNameAndSource(name, source) {
    const base = `${name}-${source || ''}`
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'monster';

    const existingAtBase = templates.get(base);
    const isSameMonster = existingAtBase && existingAtBase.name === name && existingAtBase.source === source;
    if (!existingAtBase || isSameMonster) return base;

    let n = 2;
    while (true) {
      const candidate = `${base}-${n}`;
      const existingAtCandidate = templates.get(candidate);
      if (!existingAtCandidate) return candidate;
      if (existingAtCandidate.name === name && existingAtCandidate.source === source) return candidate;
      n++;
    }
  }

  /** Parses a single 5e.tools monster entry into this app's MonsterTemplate
   *  shape. Returns null if the entry is too malformed to use (missing a
   *  name) rather than throwing -- callers count these as skipped rather
   *  than aborting the whole import over one bad entry. */
  function parseFiveToolsMonster(raw) {
    if (!raw || typeof raw !== 'string' && typeof raw !== 'object') return null;
    if (!raw.name) return null;

    const abilities = {
      str: raw.str, dex: raw.dex, con: raw.con,
      int: raw.int, wis: raw.wis, cha: raw.cha,
    };

    const traits = Array.isArray(raw.trait)
      ? raw.trait.map((t) => parseFiveToolsNamedEntry(t))
      : [];

    const spellTrait = parseFiveToolsSpellcasting(raw.spellcasting);
    if (spellTrait) traits.push(spellTrait);

    // Fold action/bonus/reaction/legendary into one `actions` list, with
    // a name prefix marking which section each came from (see file header).
    const actions = [
      ...(Array.isArray(raw.action) ? raw.action.map((a) => parseFiveToolsNamedEntry(a)) : []),
      ...(Array.isArray(raw.bonus) ? raw.bonus.map((a) => parseFiveToolsNamedEntry(a, '[Bonus]')) : []),
      ...(Array.isArray(raw.reaction) ? raw.reaction.map((a) => parseFiveToolsNamedEntry(a, '[Reaction]')) : []),
      ...(Array.isArray(raw.legendary) ? raw.legendary.map((a) => parseFiveToolsNamedEntry(a, '[Legendary]')) : []),
    ];

    const skills = parseFiveToolsBonusMap(raw.skill, titleCaseSkillName);
    const saves = parseFiveToolsBonusMap(raw.save); // keys already str/dex/con/int/wis/cha

    const dexMod = Number.isFinite(abilities.dex) ? Math.floor((abilities.dex - 10) / 2) : 0;

    return {
      id: makeIdFromNameAndSource(raw.name, raw.source),
      name: raw.name,
      source: raw.source || 'Custom',
      type: parseFiveToolsType(raw.type),
      armorClass: parseFiveToolsAc(raw.ac),
      hitPoints: parseFiveToolsHp(raw.hp),
      initiativeBonus: dexMod, // 5e.tools has no separate initiative field; derive from DEX
      speed: parseFiveToolsSpeed(raw.speed),
      challengeRating: parseFiveToolsCr(raw.cr),
      abilities,
      saves,
      skills,
      resistances: parseFiveToolsDamageList(raw.resist),
      immunities: [
        ...parseFiveToolsDamageList(raw.immune),
        ...(Array.isArray(raw.conditionImmune) ? raw.conditionImmune : []),
      ],
      senses: parseFiveToolsSenses(raw.senses),
      traits,
      actions,
    };
  }

  /** Parses an entire 5e.tools bestiary JSON ({monster: [...]} or a bare
   *  array) into { added, skipped, errors }, inserting successfully
   *  parsed monsters directly into the library. Mirrors loadFromJson's
   *  return shape so the UI's import-status messaging works unchanged
   *  regardless of which format was actually imported. */
  function loadFromFiveToolsJson(json) {
    const list = Array.isArray(json) ? json : json.monster;
    let added = 0;
    let skipped = 0;
    const errors = [];

    list.forEach((raw, idx) => {
      let parsed = null;
      try {
        parsed = parseFiveToolsMonster(raw);
      } catch (e) {
        parsed = null;
      }
      if (!parsed) {
        skipped++;
        errors.push(`Položka #${idx + 1} (${raw && raw.name ? raw.name : 'bez jména'}) se nepodařilo naparsovat z 5e.tools formátu.`);
        return;
      }
      templates.set(parsed.id, parsed);
      added++;
    });

    return { added, skipped, errors };
  }

  /**
   * Loads templates from a parsed JSON object into the library.
   * Auto-detects 5e.tools bestiary format vs this app's native
   * { monsters: [...] } format and routes to the appropriate parser.
   * @param {object} json - either { monsters: [...] } (native) or a
   *        5e.tools bestiary export ({ monster: [...] } or a bare array)
   * @param {boolean} replace - if true, clears the library first
   * @returns {{added: number, skipped: number, errors: string[]}}
   */
  function loadFromJson(json, replace) {
    if (replace) templates.clear();

    if (isFiveToolsFormat(json)) {
      return loadFromFiveToolsJson(json);
    }

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
