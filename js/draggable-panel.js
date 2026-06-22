/**
 * draggable-panel.js
 * -----------------------------------------------------------------------
 * Shared pin + drag + viewport-clamp + bring-to-front behavior for the
 * app's floating panels (the stat block popover and the spell card).
 * Both panels are visually and behaviorally near-identical -- a small
 * `position: fixed` card with a header (title + Pin + Close) and a
 * scrollable body -- so this factors out everything except each panel's
 * own content-building logic.
 *
 * Usage:
 *   const panel = DraggablePanel.create({
 *     panelEl, headerEl, pinBtn, closeBtn,
 *     onClose: () => { ... clear caller's own "what's open" state ... },
 *   });
 *   panel.showAt(left, top);   // opens the panel at a specific position
 *   panel.close();             // force-closes regardless of pin state
 *   panel.requestClose();      // closes ONLY if not pinned (click-outside / Escape)
 *   panel.isPinned();          // current pin state
 *
 * Behavior implemented here, shared by both panels:
 *  - Pin button toggles a pinned state. While pinned, requestClose() is a
 *    no-op -- only an explicit panel.close() (the Close button) ends it.
 *  - Dragging by the header: mousedown on the header starts a drag,
 *    EXCEPT when the mousedown target is the Pin or Close button, or
 *    anything inside the panel's scrollable body (so scrolling never
 *    accidentally starts a drag).
 *  - Position is tracked as plain {left, top} numbers (not transform),
 *    clamped to stay fully within the viewport on every move and once
 *    more on window resize.
 *  - Clicking anywhere on the panel brings it to front by bumping a
 *    shared z-index counter -- relevant once both panels can be open
 *    and pinned at the same time.
 * -----------------------------------------------------------------------
 */

const DraggablePanel = (() => {
  // Shared across all panel instances, so "bring to front" actually means
  // something when more than one floating panel is open simultaneously.
  let topZIndex = 1200;

  function create(opts) {
    const { panelEl, headerEl, pinBtn, closeBtn, onClose, startPinned } = opts;

    let pinned = false;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartLeft = 0;
    let panelStartTop = 0;
    // Only the very first showAt() call should honor startPinned; every
    // subsequent showAt() (reusing this same panel for a new preview)
    // must still reset to unpinned as normal.
    let firstShow = true;

    function clamp(left, top) {
      const margin = 8;
      const maxLeft = window.innerWidth - panelEl.offsetWidth - margin;
      const maxTop = window.innerHeight - panelEl.offsetHeight - margin;
      return {
        left: Math.min(Math.max(left, margin), Math.max(margin, maxLeft)),
        top: Math.min(Math.max(top, margin), Math.max(margin, maxTop)),
      };
    }

    function setPosition(left, top) {
      const clamped = clamp(left, top);
      panelEl.style.left = `${clamped.left}px`;
      panelEl.style.top = `${clamped.top}px`;
      // Once JS is driving position via left/top, drop any CSS centering
      // transform so the two positioning systems don't fight each other.
      panelEl.style.transform = 'none';
    }

    function bringToFront() {
      topZIndex += 1;
      panelEl.style.zIndex = String(topZIndex);
    }

    /** Opens the panel at a specific viewport position. Every call resets
     *  any prior drag offset and pin state to unpinned -- EXCEPT the very
     *  first call on a panel created with startPinned: true (used by
     *  spawnDetached, where the panel is born already pinned and should
     *  stay that way through its initial positioning). Position itself
     *  never persists between separate opens, per the agreed behavior. */
    function showAt(left, top) {
      if (firstShow && startPinned) {
        setPinned(true);
      } else {
        setPinned(false);
      }
      firstShow = false;
      panelEl.style.display = 'block';
      bringToFront();
      // Position after display:block so offsetWidth/Height are real.
      setPosition(left, top);
    }

    function setPinned(value) {
      pinned = value;
      pinBtn.classList.toggle('btn-primary', pinned);
    }

    function close() {
      setPinned(false);
      panelEl.style.display = 'none';
      if (onClose) onClose();
    }

    /** Closes only if NOT pinned -- this is what click-outside and a
     *  non-forced Escape should call. Pinned panels ignore this entirely;
     *  only the Close button (which calls close() directly) or
     *  unpinning-then-closing can dismiss them. */
    function requestClose() {
      if (pinned) return;
      close();
    }

    function isPinned() {
      return pinned;
    }

    // ---- Pin / Close button wiring ----

    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (opts.onPinRequested) {
        opts.onPinRequested();
      } else {
        setPinned(!pinned);
      }
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
    });

    // ---- Bring-to-front on any click within the panel ----

    panelEl.addEventListener('mousedown', () => {
      bringToFront();
    });

    // ---- Dragging by the header ----
    //
    // mousedown on the header starts a drag UNLESS it landed on the Pin
    // or Close button (those have their own click handlers and must not
    // also trigger a drag) or, defensively, anywhere that isn't the
    // header itself (e.g. inside the scrollable body, which has its own
    // mousedown-based text-selection/scroll interactions that a drag
    // listener here would otherwise interfere with).
    headerEl.addEventListener('mousedown', (e) => {
      if (e.target === pinBtn || pinBtn.contains(e.target)) return;
      if (e.target === closeBtn || closeBtn.contains(e.target)) return;

      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = panelEl.getBoundingClientRect();
      panelStartLeft = rect.left;
      panelStartTop = rect.top;
      bringToFront();
      document.body.style.userSelect = 'none'; // avoid selecting page text while dragging
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      setPosition(panelStartLeft + dx, panelStartTop + dy);
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
    });

    // Re-clamp on viewport resize so a panel dragged near an edge doesn't
    // end up partially or fully off-screen after the window shrinks.
    window.addEventListener('resize', () => {
      if (panelEl.style.display === 'none') return;
      const rect = panelEl.getBoundingClientRect();
      setPosition(rect.left, rect.top);
    });

    return { showAt, close, requestClose, isPinned, bringToFront, panelEl };
  }

  /**
   * Creates a fully independent, already-pinned panel by cloning an
   * existing template element's current DOM structure and content (deep
   * clone, so whatever HTML the caller has already rendered into the
   * "live" panel's body/title comes along with it). The clone is
   * inserted into <body> at the given position and gets its own
   * DraggablePanel instance -- entirely separate pin/drag state from
   * the template it was cloned from.
   *
   * This is what makes "pin multiple different monsters/spells at once"
   * possible: each pinned card becomes its own real DOM node rather than
   * all pinned content fighting over one shared element. The single
   * template element (the original #statblock-popover / #spell-card)
   * remains the "live preview" slot -- it's what showAt() above keeps
   * reusing for whatever the DM is currently hovering/clicking, and it
   * gets closed (hidden) by the caller at the moment a clone is spawned,
   * per the agreed behavior ("live card disappears, the new pinned copy
   * takes its place").
   *
   * Unlike create()'s close() (which just hides the template element so
   * it can be reused), a detached clone's close() REMOVES the cloned
   * element from the document entirely -- it has no "slot" to return to,
   * so there's nothing to keep around once it's dismissed.
   *
   * @param templateEl the original panel element to clone (e.g. the
   *        #statblock-popover or #spell-card element)
   * @param left, top  initial position for the new detached panel
   * @returns the same {showAt, close, requestClose, isPinned, ...} API
   *          as create(), already pinned, plus a `panelEl` reference to
   *          the cloned DOM node (callers may want it for further lookups,
   *          e.g. finding instanceId/spellId data attributes)
   */
  function spawnDetached(templateEl, left, top) {
    const clone = templateEl.cloneNode(true);
    // cloneNode copies id attributes too, which would create duplicate
    // IDs in the document -- strip them from the panel and its buttons.
    // The header/pin/close elements are found via stable shared classes
    // (panel-header / panel-pin-btn / panel-close-btn) rather than by id,
    // specifically so this works regardless of id.
    clone.removeAttribute('id');

    const headerEl = clone.querySelector('.panel-header');
    const pinBtn = clone.querySelector('.panel-pin-btn');
    const closeBtn = clone.querySelector('.panel-close-btn');
    headerEl.removeAttribute('id');
    pinBtn.removeAttribute('id');
    closeBtn.removeAttribute('id');

    document.body.appendChild(clone);

    const panel = create({
      panelEl: clone,
      headerEl,
      pinBtn,
      closeBtn,
      startPinned: true,
      onClose: () => {
        clone.remove(); // detached panels have nowhere to return to -- discard entirely
      },
    });

    panel.showAt(left, top);

    // Each detached panel manages its own dismissal -- it's fully
    // independent of whatever caller spawned it, so click-outside and
    // Escape need their own listeners here rather than depending on the
    // caller's existing handling (which only knows about its one "live"
    // slot). Both respect pin state via requestClose(): while pinned,
    // pressing Escape or clicking elsewhere does nothing; only the Close
    // button (or first unpinning, then dismissing) removes the panel.
    document.addEventListener('click', (e) => {
      if (clone.style.display === 'none') return; // already closed
      if (clone.contains(e.target)) return;
      panel.requestClose();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (clone.style.display === 'none') return;
      panel.requestClose();
    });

    return panel;
  }

  return { create, spawnDetached };
})();
