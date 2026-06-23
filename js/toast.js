/**
 * toast.js
 * -----------------------------------------------------------------------
 * Minimal reminder-toast system (bullet D). NOT a modal, NOT alert()/
 * confirm() -- just small floating notifications that appear and
 * auto-dismiss after a few seconds. Used for condition-duration
 * reminders (bullet E) and concentration-check reminders (bullet G).
 *
 * Multiple toasts can stack (e.g. a single Next Round transition can
 * trigger several condition expirations at once) -- each one manages
 * its own dismiss timer independently rather than the whole stack
 * sharing one timer, so a burst of toasts doesn't make earlier ones
 * disappear prematurely.
 * -----------------------------------------------------------------------
 */

const ReminderToast = (() => {
  const DISPLAY_MS = 4000;
  let container = null;

  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.className = 'reminder-toast-container';
    document.body.appendChild(container);
    return container;
  }

  /** Shows a single reminder toast with the given text. Auto-dismisses
   *  after DISPLAY_MS. Safe to call repeatedly in a tight loop (e.g.
   *  several condition reminders from one Next Round) -- each call
   *  creates and manages its own independent toast element. */
  function show(message) {
    const root = ensureContainer();
    const toast = document.createElement('div');
    toast.className = 'reminder-toast';
    toast.textContent = message;
    root.appendChild(toast);

    // Trigger the enter transition on the next frame (can't rely on the
    // element existing in the same frame it's appended for a CSS
    // transition to actually animate from its initial state).
    requestAnimationFrame(() => {
      toast.classList.add('reminder-toast-visible');
    });

    setTimeout(() => {
      toast.classList.remove('reminder-toast-visible');
      // Remove after the fade-out transition finishes, not immediately,
      // so the toast doesn't just vanish with no animation.
      setTimeout(() => toast.remove(), 300);
    }, DISPLAY_MS);
  }

  return { show };
})();

/** Top-level convenience function matching the name requested in the
 *  spec (bullet D: "showReminderToast(message)"), delegating to the
 *  ReminderToast module above. */
function showReminderToast(message) {
  ReminderToast.show(message);
}
