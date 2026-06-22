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
    downloadJson,
    readJsonFile,
  };
})();
