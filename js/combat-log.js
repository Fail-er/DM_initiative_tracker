/**
 * combat-log.js
 * -----------------------------------------------------------------------
 * Append-only combat log: every encounter mutation (HP, conditions, dead,
 * add/remove, initiative, grouping, sync...) gets a one-line entry here,
 * tagged with the round it happened in. Grows unbounded for the
 * lifetime of an encounter (per the agreed behavior -- no auto-trimming),
 * persisted to localStorage alongside the encounter itself, and cleared
 * together with it on New Encounter / encounter import.
 *
 * This module is a pure recorder -- it doesn't know anything about
 * monsters, players, or HP. ui.js calls add() with an already-formatted
 * message at the moment each action happens, since that's where the
 * action's meaning (display names, real numbers, etc.) is already known
 * -- reconstructing that from a state diff later would be far more
 * complex and error-prone than just describing it inline.
 *
 * Log entries always use combatants' REAL names, never the player-view
 * anonymized "Nepřítel N" label -- this log is a DM-only tool.
 * -----------------------------------------------------------------------
 */

const CombatLog = (() => {
  let entries = []; // [{ round, message, timestamp }]

  function add(round, message) {
    entries.push({ round, message, timestamp: Date.now() });
  }

  function getAll() {
    return entries;
  }

  function clear() {
    entries = [];
  }

  /** Current number of entries -- used by undo to remember "how many
   *  entries existed right before this action," so it can later trim
   *  back to exactly that point regardless of whether the action added
   *  one entry, none, or several. */
  function count() {
    return entries.length;
  }

  /** Trims the log back down to its first `n` entries, discarding
   *  anything added after that point. Used by Undo to remove whatever
   *  log entries the action being undone created -- works correctly
   *  whether that action added one entry, none, or (in the future)
   *  several, since it's driven by the actual length difference rather
   *  than assuming a fixed one-action-to-one-entry ratio. */
  function truncateTo(n) {
    if (n < entries.length) entries = entries.slice(0, n);
  }

  /** Replaces the whole log wholesale -- used when loading from storage
   *  or from an imported encounter file that carries its own log. */
  function setAll(newEntries) {
    entries = Array.isArray(newEntries) ? newEntries : [];
  }

  /** Renders the log as plain text for the Export TXT feature, one line
   *  per entry: "Round 2: Goblin 1 took 8 damage". Timestamps aren't
   *  included in the export -- the round number is the meaningful
   *  ordering for a DM reviewing a fight afterward, not wall-clock time. */
  function exportText() {
    return entries.map((e) => `Round ${e.round}: ${e.message}`).join('\n');
  }

  return { add, getAll, clear, count, truncateTo, setAll, exportText };
})();
