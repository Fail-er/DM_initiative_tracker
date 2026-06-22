/**
 * encounter.js
 * -----------------------------------------------------------------------
 * Owns the live Encounter state: active CombatantInstances (monsters AND
 * players), turn order, round counter, HP math, conditions, and grouping.
 *
 * CombatantInstance shape:
 * {
 *   instanceId, sourceType: "monster" | "player",
 *   templateId, displayName, publicName,
 *   currentHp, maxHp, tempHp, armorClass,
 *   initiative, initiativeMode: "auto" | "manual",
 *   initiativeRolled, initiativeBonus,
 *   conditions: [string], notes, isDead, groupId
 * }
 *
 * initiative is null until rolled/set -- distinct from an actual roll/entry
 * of 0. initiativeRolled is a separate explicit flag (not derived from
 * initiative !== null) because it specifically tracks whether Roll Missing
 * Initiative should still consider this combatant. It's set true whenever
 * initiative becomes determined for this encounter -- auto roll, manual
 * entry, group-applied value, or added-with-a-value.
 *
 * initiativeMode is the safety rail from bullet B/C:
 *   - "auto"   (monsters) -- Roll Missing Initiative MAY roll for these
 *   - "manual" (players)  -- Roll Missing Initiative must NEVER roll for
 *     these, regardless of initiativeRolled. Players only ever get an
 *     initiative value through explicit DM entry.
 *
 * Encounter shape:
 * { round, activeInstanceId, instances: [CombatantInstance] }
 * activeInstanceId tracks whose turn it is by id, not by list position,
 * so the turn marker survives re-sorting (new arrivals, re-rolls, manual
 * initiative edits) without silently jumping to a different combatant.
 * -----------------------------------------------------------------------
 */

const Encounter = (() => {
  const CONDITIONS = [
    'Prone', 'Grappled', 'Restrained', 'Poisoned', 'Frightened',
    'Charmed', 'Paralyzed', 'Stunned', 'Unconscious', 'Invisible',
    'Blinded', 'Deafened',
  ];

  let state = createEmpty();

  function createEmpty() {
    return { round: 1, activeInstanceId: null, instances: [] };
  }

  function uid() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** Replaces the whole encounter (used by storage load / import / new encounter).
   *  Also normalizes/migrates encounters saved by an older version of the
   *  app -- see normalizeInstance() below for the field-by-field rules
   *  (bullet H: the app must never break on old localStorage data). */
  function setState(newState) {
    if (!newState || !Array.isArray(newState.instances)) {
      state = createEmpty();
      return;
    }
    state = newState;
    state.instances = state.instances.map(normalizeInstance);

    // Backward compatibility: monsters loaded from a save predating
    // streamEnemyNumber/streamLabel get one assigned now, in their
    // current array order (the closest available stand-in for "order
    // added," since that wasn't separately recorded before). Continues
    // the sequence after any monsters that already have a number, so a
    // partially-old save (e.g. after a previous app version already
    // assigned some) doesn't renumber what's already stable.
    let nextNumber = 1;
    state.instances.forEach((inst) => {
      if (inst.sourceType === 'monster' && Number.isFinite(inst.streamEnemyNumber)) {
        nextNumber = Math.max(nextNumber, inst.streamEnemyNumber + 1);
      }
    });
    state.instances.forEach((inst) => {
      if (inst.sourceType === 'monster' && !Number.isFinite(inst.streamEnemyNumber)) {
        inst.streamEnemyNumber = nextNumber;
        inst.streamLabel = `Nepřítel ${nextNumber}`;
        nextNumber++;
      }
    });

    if (state.activeInstanceId === undefined) {
      state.activeInstanceId = null;
    }
    if (typeof state.round !== 'number') state.round = 1;
  }

  /**
   * Normalizes a single combatant loaded from storage/import, filling in
   * every field introduced after the original MonsterInstance shape so
   * the rest of the app never has to guard against missing fields.
   * Safe to run on already-current data (every check is a no-op then).
   */
  function normalizeInstance(inst) {
    if (inst.sourceType === undefined) inst.sourceType = 'monster';
    if (inst.initiativeMode === undefined) {
      inst.initiativeMode = inst.sourceType === 'player' ? 'manual' : 'auto';
    }
    if (inst.initiativeRolled === undefined) {
      inst.initiativeRolled = inst.initiative !== null && inst.initiative !== undefined;
    }
    if (inst.initiative === undefined) inst.initiative = null;
    if (inst.initiativeBonus === undefined) inst.initiativeBonus = 0;
    if (inst.publicName === undefined) inst.publicName = inst.displayName;
    if (inst.conditions === undefined) inst.conditions = [];
    if (inst.notes === undefined) inst.notes = '';
    if (inst.isDead === undefined) inst.isDead = false;
    if (inst.tempHp === undefined) inst.tempHp = 0;
    // Old groupId format (auto-assigned per add-batch, e.g. "goblin_abc123")
    // had different meaning than today's explicit-grouping format
    // ("grp_..."). Clear anything that doesn't match the current format so
    // old saves don't silently behave as if everything was DM-grouped.
    if (inst.groupId && !String(inst.groupId).startsWith('grp_')) {
      inst.groupId = null;
    }
    if (inst.groupId === undefined) inst.groupId = null;
    // streamLabel for players is just their name -- safe to backfill
    // per-instance here. Monsters' streamLabel/streamEnemyNumber need
    // sequential numbering across ALL instances, which can't be done
    // correctly one instance at a time -- see the dedicated pass in
    // setState() right after this normalization map.
    if (inst.sourceType === 'player' && inst.streamLabel === undefined) {
      inst.streamLabel = inst.displayName;
    }
    // Backward compatibility: a monster saved before isAnonymized existed
    // defaults to true, preserving the old behavior where every monster
    // was always shown as "Nepřítel N" in the player view. Newly-added
    // monsters get isAnonymized: false directly in addFromTemplate
    // (real name visible by default) -- this fallback only matters for
    // instances loaded from old saved/imported encounter data.
    if (inst.sourceType === 'monster' && inst.isAnonymized === undefined) {
      inst.isAnonymized = true;
    }
    return inst;
  }

  function getState() {
    return state;
  }

  function reset() {
    state = createEmpty();
  }

  /**
   * Adds `count` copies of a MonsterTemplate as new CombatantInstances.
   * Names are auto-numbered against any existing instances sharing the
   * template, e.g. "Goblin 1", "Goblin 2", continuing from the current
   * max index.
   *
   * groupId starts as null -- only groupSelected() ever sets it. See
   * the file-level docstring for why auto-assigning it per batch would
   * be wrong (it would make Roll Missing Initiative silently link
   * monsters the DM never asked to group).
   */
  /** Computes the next sequential enemy number for the player-view's
   *  spoiler-free generic labeling ("Nepřítel N"), counting across ALL
   *  monster instances in the encounter regardless of template/type --
   *  so 3 goblins followed by 2 wolves become Nepřítel 1-3 and 4-5, not
   *  separately-numbered per monster type. Assigned once at add time and
   *  never recalculated, so it stays stable even if other monsters are
   *  later removed or initiative reorders the turn list. */
  function nextEnemyNumber() {
    const existingNumbers = state.instances
      .filter((i) => i.sourceType === 'monster' && Number.isFinite(i.streamEnemyNumber))
      .map((i) => i.streamEnemyNumber);
    return existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;
  }

  function addFromTemplate(template, count) {
    const n = Math.max(1, Math.floor(count) || 1);
    const existingOfType = state.instances.filter((i) => i.templateId === template.id);
    let nextIndex = existingOfType.length + 1;

    const added = [];

    for (let k = 0; k < n; k++) {
      const name = `${template.name} ${nextIndex}`;
      const enemyNumber = nextEnemyNumber();
      const inst = {
        instanceId: uid(),
        sourceType: 'monster',
        templateId: template.id,
        displayName: name,
        publicName: name,
        // Spoiler-free fallback label for the player-view broadcast,
        // used only when isAnonymized is true (see below). Assigned once
        // here and never recalculated, so the number stays stable
        // whenever the DM later toggles anonymization on.
        streamEnemyNumber: enemyNumber,
        streamLabel: `Nepřítel ${enemyNumber}`,
        // New default: monsters show their REAL name in the player view
        // unless the DM explicitly anonymizes them (common monsters like
        // wolves/goblins rarely need hiding; bosses/uniques do). This
        // only affects newly-added monsters -- see setState()'s
        // backward-compat pass for how existing saved encounters are
        // handled (they keep the old always-anonymous behavior).
        isAnonymized: false,
        currentHp: template.hitPoints,
        maxHp: template.hitPoints,
        tempHp: 0,
        armorClass: template.armorClass,
        initiative: null,
        initiativeMode: 'auto',
        initiativeRolled: false,
        initiativeBonus: template.initiativeBonus || 0,
        conditions: [],
        notes: '',
        isDead: false,
        groupId: null,
      };
      nextIndex++;
      state.instances.push(inst);
      added.push(inst);
    }
    return added;
  }

  /**
   * Adds a single PlayerTemplate as a new CombatantInstance.
   * If initiativeValue is a finite number, the combatant is considered
   * "settled" immediately (initiativeRolled = true) since the DM supplied
   * it directly. If omitted/null, the combatant enters with no initiative
   * and initiativeRolled stays false -- but initiativeMode is always
   * "manual" for players, so Roll Missing Initiative will NEVER pick this
   * combatant up regardless of initiativeRolled. The DM must enter it by
   * hand, later, in the detail panel or turn row.
   */
  function addPlayerFromTemplate(template, initiativeValue) {
    const hasInitiative = Number.isFinite(initiativeValue);
    const inst = {
      instanceId: uid(),
      sourceType: 'player',
      templateId: template.id,
      displayName: template.name,
      publicName: template.name,
      // Players are never anonymized in the player-view broadcast --
      // their real name is exactly what should show.
      streamLabel: template.name,
      currentHp: template.currentHp,
      maxHp: template.maxHp,
      tempHp: template.tempHp || 0,
      armorClass: template.armorClass,
      initiative: hasInitiative ? initiativeValue : null,
      initiativeMode: 'manual',
      initiativeRolled: hasInitiative,
      initiativeBonus: template.initiativeBonus || 0,
      conditions: [],
      notes: '',
      isDead: false,
      groupId: null,
    };
    state.instances.push(inst);
    return inst;
  }

  /** True if a player with this templateId is already present in the encounter.
   *  Used by "Add All Players" to skip duplicates. */
  function hasPlayerInstance(templateId) {
    return state.instances.some((i) => i.sourceType === 'player' && i.templateId === templateId);
  }

  /**
   * Syncs a live player CombatantInstance with the latest PlayerTemplate
   * from the library (bullet K). This is a deliberate, DM-triggered action
   * (the "Sync selected player from library" button) -- it is never run
   * automatically, so editing a player in Player Manager mid-fight never
   * silently rewrites the live encounter.
   *
   * Updated from the template: displayName/publicName, armorClass, maxHp,
   * initiativeBonus, speed (stored as part of the synced snapshot below),
   * abilities, savingThrows, skills, passivePerception, passiveInsight,
   * passiveInvestigation, senses, importantAbilities.
   *
   * Left COMPLETELY untouched: currentHp, tempHp, initiative,
   * initiativeRolled, conditions, isDead, notes, groupId. In particular,
   * if maxHp changes, currentHp is NOT clamped or rescaled here -- the DM
   * adjusts it by hand afterwards if needed, per the spec.
   *
   * Note: abilities/savingThrows/skills/passives/importantAbilities/speed/
   * senses aren't part of the original CombatantInstance shape (they live
   * on the template and are read live via templateId lookups elsewhere in
   * the UI). Storing a synced snapshot of them directly on the instance
   * would duplicate state and risk drifting out of sync again. Since the
   * detail panel and stat strip already resolve these through
   * PlayerLibrary.getById(inst.templateId), syncing them really just means
   * "make sure the instance points at the latest template data" -- which
   * is already true by definition once the library itself has been
   * updated and re-loaded. What DOES need explicit copying onto the
   * instance is the small set of fields the instance keeps its own copy
   * of for fast access: displayName/publicName, armorClass, maxHp,
   * initiativeBonus.
   */
  function syncPlayerFromTemplate(instanceId, template) {
    const inst = getInstance(instanceId);
    if (!inst || !template || inst.sourceType !== 'player') return false;

    inst.displayName = template.name;
    inst.publicName = template.name;
    inst.armorClass = template.armorClass;
    inst.maxHp = template.maxHp;
    inst.initiativeBonus = template.initiativeBonus || 0;
    // currentHp, tempHp, initiative, initiativeRolled, conditions, isDead,
    // notes, groupId are deliberately NOT touched above.
    return true;
  }

  function getInstance(instanceId) {
    return state.instances.find((i) => i.instanceId === instanceId) || null;
  }

  function removeInstance(instanceId) {
    state.instances = state.instances.filter((i) => i.instanceId !== instanceId);
  }

  /** Sorts the turn order list by initiative descending (stable for ties).
   *  Instances that haven't rolled yet (initiative === null) sort to the
   *  bottom, below any real roll/entry including 0. */
  function sortedInstances() {
    return [...state.instances]
      .map((inst, idx) => ({ inst, idx })) // keep original index for stable tie-break
      .sort((a, b) => {
        const aInit = a.inst.initiative;
        const bInit = b.inst.initiative;
        if (aInit === null && bInit === null) return a.idx - b.idx;
        if (aInit === null) return 1;
        if (bInit === null) return -1;
        return (bInit - aInit) || (a.idx - b.idx);
      })
      .map((x) => x.inst);
  }

  /** Manually sets initiative (DM typed a value). Marks initiativeRolled
   *  true whenever a real number is supplied -- this is the only path by
   *  which a "manual" (player) combatant's initiative is ever set. Clearing
   *  back to blank (value = null/non-finite) resets initiativeRolled to
   *  false, so a cleared combatant is picked up again correctly (monsters
   *  by Roll Missing Initiative; players only by hand). */
  function setInitiative(instanceId, value) {
    const inst = getInstance(instanceId);
    if (!inst) return;
    if (Number.isFinite(value)) {
      inst.initiative = value;
      inst.initiativeRolled = true;
    } else {
      inst.initiative = null;
      inst.initiativeRolled = false;
    }
  }

  /**
   * Rolls d20 + initiativeBonus for every eligible combatant. Eligible
   * means BOTH:
   *   - initiativeMode === "auto"      (monsters; players are "manual"
   *                                      and are never touched here)
   *   - initiativeRolled === false     (hasn't been settled yet this
   *                                      encounter)
   * This is the safety rail from bullet B/C: players must never be
   * auto-rolled, no matter what state their initiative is in.
   *
   * Grouped instances (sharing a non-null groupId) are rolled as a single
   * unit: one roll is made per group and applied to every eligible member,
   * rather than rolling each member separately. This matters because a DM
   * may group monsters together BEFORE any of them have initiative -- in
   * that case every member is eligible, and rolling them independently
   * would silently scatter the group's initiative despite sharing a
   * groupId. Solo (ungrouped) eligible instances are rolled individually.
   */
  function rollMissingInitiative() {
    const rolledGroups = new Map(); // groupId -> rolled initiative value

    state.instances.forEach((inst) => {
      const eligible = inst.initiativeMode === 'auto' && inst.initiativeRolled === false;
      if (!eligible) return;

      const isGrouped = inst.groupId != null;
      if (isGrouped && rolledGroups.has(inst.groupId)) {
        inst.initiative = rolledGroups.get(inst.groupId);
        inst.initiativeRolled = true;
        return;
      }

      const roll = Math.floor(Math.random() * 20) + 1;
      const result = roll + (inst.initiativeBonus || 0);
      inst.initiative = result;
      inst.initiativeRolled = true;

      if (isGrouped) rolledGroups.set(inst.groupId, result);
    });
  }

  /** Re-rolls a single instance's initiative on demand, regardless of its
   *  current initiativeRolled state. Used by the per-combatant re-roll
   *  button in the detail panel. Only ever called for sourceType "monster"
   *  from the UI (the button is hidden/disabled for players), but the
   *  guard here is a second line of defense: a manual-mode combatant is
   *  refused even if called directly. */
  function rollInitiativeFor(instanceId) {
    const inst = getInstance(instanceId);
    if (!inst || inst.initiativeMode !== 'auto') return;
    const roll = Math.floor(Math.random() * 20) + 1;
    inst.initiative = roll + (inst.initiativeBonus || 0);
    inst.initiativeRolled = true;
  }

  /**
   * Manually groups the given instanceIds together: assigns them all a
   * shared groupId, and sets their initiative to match the first selected
   * instance (by current sort order, so the "leader" is whoever's highest).
   * Works across monsters and players alike -- grouping itself just means
   * "these act on the same initiative count," which is meaningful for any
   * combatant type. If the lead instance hasn't rolled/been set yet,
   * initiative stays null for the whole group; Roll Missing Initiative will
   * then roll once for the group (for eligible monster members) next time
   * it runs.
   */
  function groupSelected(instanceIds) {
    const idSet = new Set(instanceIds);
    const members = sortedInstances().filter((i) => idSet.has(i.instanceId));
    if (members.length < 2) return;

    const newGroupId = 'grp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const lead = members[0];

    members.forEach((m) => {
      m.groupId = newGroupId;
      m.initiative = lead.initiative;
      // Only mark "rolled" if the lead's value is real -- if the lead is
      // also still unrolled, grouping shouldn't fake-settle the others.
      if (lead.initiative !== null) m.initiativeRolled = true;
    });
  }

  /** Sets initiative for every instance in the same group as instanceId to that instance's value.
   *  Used when the DM manually edits one group member's initiative and wants the rest to follow. */
  function applyGroupInitiative(instanceId) {
    const inst = getInstance(instanceId);
    if (!inst || inst.groupId == null) return;
    state.instances
      .filter((i) => i.groupId === inst.groupId)
      .forEach((i) => {
        i.initiative = inst.initiative;
        if (inst.initiative !== null) i.initiativeRolled = true;
      });
  }

  // ---- HP ----------------------------------------------------------------

  function clampHp(inst) {
    if (inst.currentHp > inst.maxHp) inst.currentHp = inst.maxHp;
    if (inst.currentHp < 0) inst.currentHp = 0;
    if (inst.currentHp === 0) inst.isDead = true;
  }

  function applyDelta(instanceId, delta) {
    const inst = getInstance(instanceId);
    if (!inst) return;
    inst.currentHp += delta;
    clampHp(inst);
    if (inst.currentHp > 0) inst.isDead = false;
  }

  function setHp(instanceId, value) {
    const inst = getInstance(instanceId);
    if (!inst || !Number.isFinite(value)) return;
    inst.currentHp = value;
    clampHp(inst);
    if (inst.currentHp > 0) inst.isDead = false;
  }

  function setMax(instanceId) {
    const inst = getInstance(instanceId);
    if (!inst) return;
    inst.currentHp = inst.maxHp;
    inst.isDead = false;
  }

  function markDead(instanceId) {
    const inst = getInstance(instanceId);
    if (!inst) return;
    inst.currentHp = 0;
    inst.isDead = true;
  }

  /** Toggles whether a monster shows its real name or the generic
   *  "Nepřítel N" label in the player-view broadcast. No-op for players
   *  (sourceType !== 'monster') -- they're never anonymized regardless
   *  of any attempt to toggle this on them. */
  function toggleMonsterAnonymization(instanceId) {
    const inst = getInstance(instanceId);
    if (!inst || inst.sourceType !== 'monster') return;
    inst.isAnonymized = !inst.isAnonymized;
  }

  // ---- Conditions ----------------------------------------------------------------

  function addCondition(instanceId, condition) {
    const inst = getInstance(instanceId);
    if (!inst || inst.conditions.includes(condition)) return;
    inst.conditions.push(condition);
  }

  function removeCondition(instanceId, condition) {
    const inst = getInstance(instanceId);
    if (!inst) return;
    inst.conditions = inst.conditions.filter((c) => c !== condition);
  }

  function setNotes(instanceId, text) {
    const inst = getInstance(instanceId);
    if (!inst) return;
    inst.notes = text;
  }

  // ---- Turn order ----------------------------------------------------------------

  /** Returns the instanceId of whoever's turn it is.
   *  Tracked directly by instanceId (not a position index), so reordering
   *  the list -- by adding a combatant, re-rolling, or editing initiative
   *  mid-fight -- never silently changes whose turn it is. */
  /** True for combatants that Next Turn / Previous Turn should skip over
   *  entirely -- currently just dead monsters. Players are NEVER
   *  skipped, even at 0 HP/dead, since a player may still need their
   *  turn (e.g. to roll a death save) -- only monsters, which have no
   *  equivalent mechanic, are skipped once dead. */
  function isSkippableForTurnOrder(inst) {
    return inst.sourceType === 'monster' && inst.isDead === true;
  }

  function getActiveInstanceId() {
    const ordered = sortedInstances();
    if (!ordered.length) return null;

    if (state.activeInstanceId && ordered.some((i) => i.instanceId === state.activeInstanceId)) {
      return state.activeInstanceId;
    }
    return ordered[0].instanceId;
  }

  /** Advances to the next combatant in turn order, skipping over any
   *  dead monsters along the way (players are never skipped -- see
   *  isSkippableForTurnOrder). Wrapping past the last combatant rolls
   *  over to the first AND increments the round counter -- reaching the
   *  end of the initiative order is exactly when a new round begins,
   *  regardless of whether the DM got there one step at a time or used
   *  nextRound() to jump there directly.
   *
   *  If every remaining candidate is skippable (e.g. the entire rest of
   *  the encounter is dead monsters), the loop gives up after one full
   *  pass and lands on the next slot anyway, rather than spinning
   *  forever -- an all-dead-monsters encounter is a degenerate case the
   *  DM should resolve some other way (Remove them, add a new combatant,
   *  etc.), not something this function needs to handle gracefully. */
  function nextTurn() {
    const ordered = sortedInstances();
    if (!ordered.length) return;
    const currentId = getActiveInstanceId();
    const startIdx = ordered.findIndex((i) => i.instanceId === currentId);

    let idx = startIdx;
    let wrapped = false;
    for (let steps = 0; steps < ordered.length; steps++) {
      idx = (idx + 1) % ordered.length;
      if (idx === 0) wrapped = true;
      if (!isSkippableForTurnOrder(ordered[idx])) break;
    }

    state.activeInstanceId = ordered[idx].instanceId;
    if (wrapped) state.round++;
  }

  /** Steps back to the previous combatant in turn order, skipping over
   *  dead monsters the same way nextTurn() does. Mirrors nextTurn() for
   *  round-counter purposes too: wrapping backward from the first
   *  combatant to the last decrements the round counter, clamped at a
   *  minimum of 1. */
  function previousTurn() {
    const ordered = sortedInstances();
    if (!ordered.length) return;
    const currentId = getActiveInstanceId();
    const startIdx = ordered.findIndex((i) => i.instanceId === currentId);

    let idx = startIdx;
    let wrapped = false;
    for (let steps = 0; steps < ordered.length; steps++) {
      idx = (idx - 1 + ordered.length) % ordered.length;
      if (idx === ordered.length - 1) wrapped = true;
      if (!isSkippableForTurnOrder(ordered[idx])) break;
    }

    state.activeInstanceId = ordered[idx].instanceId;
    if (wrapped) state.round = Math.max(1, state.round - 1);
  }

  /** Jumps straight to the top of the turn order and increments the round
   *  counter. Still useful as an explicit "skip the rest of this round"
   *  action distinct from stepping through every remaining combatant. */
  function nextRound() {
    const ordered = sortedInstances();
    if (!ordered.length) return;
    state.activeInstanceId = ordered[0].instanceId;
    state.round++;
  }

  return {
    CONDITIONS,
    createEmpty,
    setState,
    getState,
    reset,
    addFromTemplate,
    addPlayerFromTemplate,
    hasPlayerInstance,
    syncPlayerFromTemplate,
    getInstance,
    removeInstance,
    sortedInstances,
    setInitiative,
    rollMissingInitiative,
    rollInitiativeFor,
    groupSelected,
    applyGroupInitiative,
    applyDelta,
    setHp,
    setMax,
    markDead,
    toggleMonsterAnonymization,
    addCondition,
    removeCondition,
    setNotes,
    getActiveInstanceId,
    nextTurn,
    previousTurn,
    nextRound,
  };
})();
