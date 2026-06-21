/**
 * app.js
 * -----------------------------------------------------------------------
 * Entry point. Loads the bundled sample monster library (or the user's
 * previously-imported library from localStorage, if present), restores
 * any persisted encounter, and boots the UI.
 * -----------------------------------------------------------------------
 */

(function bootstrap() {
  function start(sampleMonsterJson, samplePlayerJson) {
    // Prefer a previously saved/imported library over the bundled sample,
    // so a DM's custom monster set survives page reloads. Fall back to
    // sample data on first run.
    const savedLibrary = Storage.loadLibrary();
    if (savedLibrary && Array.isArray(savedLibrary.monsters) && savedLibrary.monsters.length) {
      MonsterLibrary.loadFromJson(savedLibrary, true);
    } else {
      MonsterLibrary.loadFromJson(sampleMonsterJson, true);
      Storage.saveLibrary(MonsterLibrary.getAll());
    }

    const savedPlayers = Storage.loadPlayers();
    if (savedPlayers && Array.isArray(savedPlayers.players) && savedPlayers.players.length) {
      PlayerLibrary.loadFromJson(savedPlayers, true);
    } else {
      PlayerLibrary.loadFromJson(samplePlayerJson, true);
      Storage.savePlayers(PlayerLibrary.getAll());
    }

    const savedEncounter = Storage.loadEncounter();
    if (savedEncounter) {
      Encounter.setState(savedEncounter);
    }

    UI.init();
  }

  // Try to fetch the bundled sample files. This works when the page is
  // served over http(s) or in browsers that allow fetch() for local
  // file:// JSON. If that fails (some browsers block file:// fetch),
  // fall back to inline copies so the app still works by just opening
  // index.html directly.
  Promise.all([
    fetch('data/sample-monsters.json').then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }),
    fetch('data/sample-players.json').then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }),
  ])
    .then(([monsters, players]) => start(monsters, players))
    .catch(() => start(INLINE_SAMPLE_MONSTERS, INLINE_SAMPLE_PLAYERS));
})();

/**
 * Inline fallback copy of data/sample-monsters.json.
 * Used only if fetch() is blocked (typically when opening index.html
 * directly via file:// in a browser that disallows local fetch).
 * Keep this in sync with data/sample-monsters.json.
 */
const INLINE_SAMPLE_MONSTERS = {
  monsters: [
    {
      id: 'goblin', name: 'Goblin', source: 'MM', type: 'Humanoid',
      armorClass: 15, hitPoints: 7, initiativeBonus: 2, speed: '30 ft.', challengeRating: '1/4',
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
      saves: {}, skills: { Stealth: 6 }, resistances: [], immunities: [],
      senses: 'Darkvision 60 ft., Passive Perception 9',
      traits: [{ name: 'Nimble Escape', text: 'The goblin can take the Disengage or Hide action as a bonus action on each of its turns.' }],
      actions: [
        { name: 'Scimitar', text: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.' },
        { name: 'Shortbow', text: 'Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.' },
      ],
    },
    {
      id: 'wolf', name: 'Wolf', source: 'MM', type: 'Beast',
      armorClass: 13, hitPoints: 11, initiativeBonus: 2, speed: '40 ft.', challengeRating: '1/4',
      abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
      saves: {}, skills: { Perception: 3, Stealth: 4 }, resistances: [], immunities: [],
      senses: 'Passive Perception 13',
      traits: [
        { name: 'Keen Hearing and Smell', text: 'The wolf has advantage on Wisdom (Perception) checks that rely on hearing or smell.' },
        { name: 'Pack Tactics', text: "The wolf has advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 ft. of the creature and the ally isn't incapacitated." },
      ],
      actions: [
        { name: 'Bite', text: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage. If the target is a creature, it must succeed on a DC 11 Strength saving throw or be knocked prone.' },
      ],
    },
    {
      id: 'bandit', name: 'Bandit', source: 'MM', type: 'Humanoid',
      armorClass: 12, hitPoints: 11, initiativeBonus: 1, speed: '30 ft.', challengeRating: '1/8',
      abilities: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      saves: {}, skills: {}, resistances: [], immunities: [],
      senses: 'Passive Perception 10',
      traits: [],
      actions: [
        { name: 'Scimitar', text: 'Melee Weapon Attack: +3 to hit, reach 5 ft., one target. Hit: 4 (1d6 + 1) slashing damage.' },
        { name: 'Light Crossbow', text: 'Ranged Weapon Attack: +3 to hit, range 80/320 ft., one target. Hit: 5 (1d8 + 1) piercing damage.' },
      ],
    },
    {
      id: 'ogre', name: 'Ogre', source: 'MM', type: 'Giant',
      armorClass: 11, hitPoints: 59, initiativeBonus: -1, speed: '40 ft.', challengeRating: '2',
      abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
      saves: {}, skills: {}, resistances: [], immunities: [],
      senses: 'Darkvision 60 ft., Passive Perception 8',
      traits: [],
      actions: [
        { name: 'Greatclub', text: 'Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 13 (2d8 + 4) bludgeoning damage.' },
        { name: 'Javelin', text: 'Ranged Weapon Attack: +6 to hit, range 30/120 ft., one target. Hit: 11 (2d6 + 4) piercing damage.' },
      ],
    },
    {
      id: 'skeleton', name: 'Skeleton', source: 'MM', type: 'Undead',
      armorClass: 13, hitPoints: 13, initiativeBonus: 2, speed: '30 ft.', challengeRating: '1/4',
      abilities: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
      saves: {}, skills: {}, resistances: [], immunities: ['Poison'],
      senses: 'Darkvision 60 ft., Passive Perception 9',
      traits: [],
      actions: [
        { name: 'Shortsword', text: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage.' },
        { name: 'Shortbow', text: 'Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.' },
      ],
    },
  ],
};

/**
 * Inline fallback copy of data/sample-players.json.
 * Used only if fetch() is blocked. Keep in sync with the JSON file.
 */
const INLINE_SAMPLE_PLAYERS = {
  players: [
    {
      id: 'zapal', name: 'Zápal', className: 'Barbar', level: 5,
      armorClass: 15, maxHp: 44, currentHp: 44, tempHp: 0, initiativeBonus: 2, speed: '40 ft.',
      abilities: { str: 18, dex: 14, con: 16, int: 8, wis: 10, cha: 8 },
      savingThrows: { str: 7, dex: 5, con: 6, int: -1, wis: 0, cha: -1 },
      skills: { Athletics: 7, Intimidation: 2 },
      passivePerception: 10, passiveInsight: 10, passiveInvestigation: null,
      senses: '', notes: '',
      importantAbilities: [
        { name: 'Rage', text: '+2 damage on melee, resistance to physical damage. Lasts 1 minute.' },
        { name: 'Reckless Attack', text: 'Advantage on melee Strength attacks this turn, but attacks against him have advantage too.' },
      ],
    },
    {
      id: 'aeris', name: 'Aeris', className: 'Klerik', level: 5,
      armorClass: 16, maxHp: 31, currentHp: 31, tempHp: 0, initiativeBonus: 0, speed: '30 ft.',
      abilities: { str: 10, dex: 10, con: 14, int: 12, wis: 17, cha: 12 },
      savingThrows: { str: 0, dex: 0, con: 2, int: 1, wis: 6, cha: 1 },
      skills: { Medicine: 6, Insight: 6, Religion: 4 },
      passivePerception: 13, passiveInsight: 16, passiveInvestigation: 11,
      senses: '', notes: '',
      importantAbilities: [
        { name: 'Channel Divinity', text: '1/short rest. Various clerical effects depending on chosen domain.' },
        { name: 'Spirit Guardians', text: '3rd level spell. Radiant or necrotic damage to enemies within 15 ft.' },
      ],
    },
    {
      id: 'gimble', name: 'Gimble', className: 'Hobit Zloděj', level: 5,
      armorClass: 14, maxHp: 28, currentHp: 28, tempHp: 0, initiativeBonus: 4, speed: '25 ft.',
      abilities: { str: 8, dex: 18, con: 12, int: 13, wis: 12, cha: 14 },
      savingThrows: { str: -1, dex: 7, con: 1, int: 1, wis: 1, cha: 2 },
      skills: { Stealth: 9, SleightOfHand: 7, Perception: 3 },
      passivePerception: 13, passiveInsight: 11, passiveInvestigation: 11,
      senses: '', notes: '',
      importantAbilities: [
        { name: 'Sneak Attack', text: 'Once per turn, +3d6 damage on an attack with advantage or with an ally adjacent to the target.' },
        { name: 'Cunning Action', text: 'Bonus action to Dash, Disengage, or Hide.' },
      ],
    },
  ],
};
