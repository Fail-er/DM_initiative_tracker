/**
 * toast.js
 * -----------------------------------------------------------------------
 * Persistent reminders panel (formerly a floating auto-dismissing toast
 * system -- replaced per the visualization, which shows a fixed list
 * under the library panel instead). Holds a short FIFO-capped history:
 * whenever a new reminder arrives once the list is at capacity, the
 * OLDEST entry is dropped automatically, regardless of whether the DM
 * has "read" it -- there's no separate read/unread state, just a fixed
 * recency window.
 *
 * Each entry can be one of two shapes:
 *   - a plain string (e.g. concentration-check messages, built already
 *     as finished text in ui.js since there's nothing further to
 *     colorize there beyond the combatant name, which IS colorized via
 *     a lightweight inline split -- see render() below)
 *   - a structured condition-reminder object from encounter.js:
 *     { kind: 'condition', conditionName, combatantName, suffix, separator? }
 *     which renders with the condition name and combatant name in their
 *     own distinct colors, matching the visualization's highlighted
 *     "Frightened on Goblin 2 expires now" style.
 * -----------------------------------------------------------------------
 */

const ReminderToast = (() => {
  const MAX_ENTRIES = 3;
  let entries = []; // newest last; each { data, timestamp }
  let listEl = null;
  let clearBtn = null;

  function ensureRefs() {
    if (!listEl) listEl = document.getElementById('reminders-list');
    if (!clearBtn) {
      clearBtn = document.getElementById('clear-reminders-btn');
      if (clearBtn) clearBtn.addEventListener('click', clear);
    }
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /** Builds the inner HTML for one reminder entry's message, applying
   *  the visualization's highlight colors: condition names in one
   *  accent color, combatant names in another. Concentration-check
   *  strings (plain text, already fully formed by ui.js) get a
   *  lightweight regex-based name highlight instead of full structured
   *  parsing, since their only colorized part is the combatant name and
   *  the message shape is fixed/known ("Concentration check for X, damage N."). */
  function buildMessageHtml(entry) {
    if (typeof entry === 'string') {
      // Concentration-check message: highlight whatever sits between
      // "for " and ",", which is always the combatant name in the one
      // fixed sentence shape this string can have.
      const match = entry.match(/^(.*for )([^,]+)(,.*)$/);
      if (match) {
        return `${escapeHtml(match[1])}<span class="reminder-name">${escapeHtml(match[2])}</span>${escapeHtml(match[3])}`;
      }
      return escapeHtml(entry);
    }

    // Structured condition-reminder object from encounter.js.
    const sep = entry.separator || '';
    return `<span class="reminder-condition">${escapeHtml(entry.conditionName)}</span> on <span class="reminder-name">${escapeHtml(entry.combatantName)}</span>${sep} ${escapeHtml(entry.suffix)}`;
  }

  /** Icon shown per entry kind -- condition reminders get a skull
   *  (matching the visualization's purple skull icon for condition
   *  expirations), anything else (currently just concentration-check
   *  plain strings) gets a different icon to stay visually distinct. */
  function iconFor(entry) {
    if (typeof entry === 'object' && entry.kind === 'condition') return '💀';
    return '✦';
  }

  function render() {
    ensureRefs();
    if (!listEl) return; // page doesn't have a reminders panel (e.g. player-view.html)

    if (!entries.length) {
      listEl.innerHTML = '<p class="empty-hint">Žádné připomínky.</p>';
      return;
    }

    // Newest first in the rendered list (most recent reminder is the
    // most relevant one for the DM to see without scrolling).
    listEl.innerHTML = entries.slice().reverse().map((e) => `
      <div class="reminder-item">
        <span class="reminder-icon">${iconFor(e.data)}</span>
        <span class="reminder-text">${buildMessageHtml(e.data)}</span>
        <span class="reminder-time">${formatTime(e.timestamp)}</span>
      </div>
    `).join('');
  }

  /** Adds a new reminder, dropping the oldest entry first if already at
   *  MAX_ENTRIES -- a strict FIFO window, not a read/unread queue. */
  function show(data) {
    entries.push({ data, timestamp: Date.now() });
    if (entries.length > MAX_ENTRIES) entries.shift();
    render();
  }

  function clear() {
    entries = [];
    render();
  }

  return { show, clear, render };
})();

/** Top-level convenience function (kept as the stable public name every
 *  caller in ui.js already uses), delegating to the ReminderToast
 *  module above. Accepts either a plain string or a structured
 *  condition-reminder object -- see ReminderToast.buildMessageHtml. */
function showReminderToast(message) {
  ReminderToast.show(message);
}
