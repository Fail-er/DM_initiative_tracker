/**
 * storage.js
 * -----------------------------------------------------------------------
 * Handles localStorage persistence of the encounter and the monster
 * library, plus JSON export/import of encounter state to a file.
 * -----------------------------------------------------------------------
 */

const Storage = (() => {
  const ENCOUNTER_KEY = 'dnd-tracker:encounter';
  const LIBRARY_KEY = 'dnd-tracker:library';
  const PLAYERS_KEY = 'dnd-tracker:players';
  const SPELLS_KEY = 'dnd-tracker:spells';
  const COMBAT_LOG_KEY = 'dnd-tracker:combat-log';

  function saveEncounter(state) {
    try {
      localStorage.setItem(ENCOUNTER_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Nepodařilo se uložit encounter do localStorage:', e);
    }
  }

  function loadEncounter() {
    try {
      const raw = localStorage.getItem(ENCOUNTER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Nepodařilo se načíst encounter z localStorage:', e);
      return null;
    }
  }

  function saveLibrary(templates) {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify({ monsters: templates }));
    } catch (e) {
      console.error('Nepodařilo se uložit knihovnu monster do localStorage:', e);
    }
  }

  function loadLibrary() {
    try {
      const raw = localStorage.getItem(LIBRARY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Nepodařilo se načíst knihovnu monster z localStorage:', e);
      return null;
    }
  }

  function savePlayers(templates) {
    try {
      localStorage.setItem(PLAYERS_KEY, JSON.stringify({ players: templates }));
    } catch (e) {
      console.error('Nepodařilo se uložit knihovnu hráčů do localStorage:', e);
    }
  }

  function loadPlayers() {
    try {
      const raw = localStorage.getItem(PLAYERS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Nepodařilo se načíst knihovnu hráčů z localStorage:', e);
      return null;
    }
  }

  function saveSpells(templates) {
    try {
      localStorage.setItem(SPELLS_KEY, JSON.stringify({ spells: templates }));
    } catch (e) {
      console.error('Nepodařilo se uložit knihovnu kouzel do localStorage:', e);
    }
  }

  function loadSpells() {
    try {
      const raw = localStorage.getItem(SPELLS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Nepodařilo se načíst knihovnu kouzel z localStorage:', e);
      return null;
    }
  }

  function saveCombatLog(entries) {
    try {
      localStorage.setItem(COMBAT_LOG_KEY, JSON.stringify(entries));
    } catch (e) {
      console.error('Nepodařilo se uložit combat log do localStorage:', e);
    }
  }

  function loadCombatLog() {
    try {
      const raw = localStorage.getItem(COMBAT_LOG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Nepodařilo se načíst combat log z localStorage:', e);
      return null;
    }
  }

  // All localStorage keys the app uses, in one place -- both
  // exportAllBackup and importAllBackup iterate this list, so adding a
  // new persisted feature later just means adding its key here rather
  // than touching the backup logic itself.
  const ALL_STORAGE_KEYS = {
    encounter: ENCOUNTER_KEY,
    library: LIBRARY_KEY,
    players: PLAYERS_KEY,
    spells: SPELLS_KEY,
    combatLog: COMBAT_LOG_KEY,
  };

  /**
   * Bundles every localStorage key the app uses into one backup object,
   * downloadable as a single .json file. Reads each key's RAW string
   * value directly (not through e.g. loadEncounter()'s JSON.parse +
   * null-on-error handling) so a single corrupted/missing key doesn't
   * prevent the rest of the backup from being collected -- each entry
   * is independently null if absent or unreadable, rather than the
   * whole export failing.
   */
  function exportAllBackup() {
    const data = {};
    Object.entries(ALL_STORAGE_KEYS).forEach(([name, key]) => {
      try {
        data[name] = localStorage.getItem(key); // raw string, or null if absent
      } catch (e) {
        data[name] = null;
      }
    });
    return {
      format: 'dnd-tracker-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      data,
    };
  }

  /**
   * Restores localStorage from a backup object previously produced by
   * exportAllBackup(). Writes each key's raw value back directly. A key
   * that's missing or null in the backup is left untouched in
   * localStorage (not cleared) -- this means restoring an older backup
   * that predates some newer feature (e.g. spells) won't wipe out data
   * for that feature if it already exists locally; it simply doesn't
   * touch it either way.
   * @returns {{restored: string[], skipped: string[]}} which named
   *          sections were actually written vs. left alone (absent from
   *          the backup file), for the caller to report back to the DM.
   */
  function importAllBackup(backup) {
    const restored = [];
    const skipped = [];
    const source = backup && backup.data ? backup.data : {};

    Object.entries(ALL_STORAGE_KEYS).forEach(([name, key]) => {
      const value = source[name];
      if (typeof value === 'string') {
        try {
          localStorage.setItem(key, value);
          restored.push(name);
        } catch (e) {
          skipped.push(name);
        }
      } else {
        skipped.push(name);
      }
    });

    return { restored, skipped };
  }

  /** Triggers a browser download of a plain-text string -- used by the
   *  Combat Log's Export TXT button. Separate from downloadJson since
   *  this isn't JSON and shouldn't be pretty-printed/stringified. */
  function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Triggers a browser download of the given object as a pretty-printed JSON file. */
  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Reads a File object (from an <input type="file">) and resolves with parsed JSON.
   * Rejects with a human-readable error message on failure.
   */
  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject('Žádný soubor nebyl vybrán.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          resolve(parsed);
        } catch (e) {
          reject('Soubor neobsahuje platný JSON: ' + e.message);
        }
      };
      reader.onerror = () => reject('Soubor se nepodařilo přečíst.');
      reader.readAsText(file);
    });
  }

  return {
    saveEncounter,
    loadEncounter,
    saveLibrary,
    loadLibrary,
    savePlayers,
    loadPlayers,
    saveSpells,
    loadSpells,
    saveCombatLog,
    loadCombatLog,
    exportAllBackup,
    importAllBackup,
    downloadJson,
    downloadText,
    readJsonFile,
  };
})();
