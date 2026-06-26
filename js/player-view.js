/**
 * player-view.js
 * -----------------------------------------------------------------------
 * Renders the player-facing combat overview: name/label, initiative,
 * turn order, who's currently active, and conditions. Receives its data
 * exclusively via PlayerViewChannel broadcasts from the main tracker --
 * this page has no state of its own and makes no decisions about what
 * to show beyond "render whatever payload arrived most recently."
 *
 * Deliberately does NOT show HP (per the agreed scope) and never shows
 * a monster's real name/type -- monsters arrive already anonymized as
 * "Nepřítel N" by the sender (encounter.js's streamLabel), this file
 * just displays whatever label it's given.
 * -----------------------------------------------------------------------
 */

(function init() {
  const waitingState = document.getElementById('waiting-state');
  const main = document.getElementById('player-view-main');
  const roundNumberEl = document.getElementById('player-view-round-number');
  const listEl = document.getElementById('player-view-list');
  const flameGlow = document.querySelector('.player-view-flame-glow');
  const fog = document.querySelector('.player-view-fog');

  // Source image's pixel dimensions and the measured inner-frame
  // boundary (the area inside the thin gold border line, NOT the wider
  // decorated band with the sword/pillar -- those sit outside the line).
  // Measured directly from assets/initiative-background.png's pixels;
  // expressed as fractions of the image so they stay correct regardless
  // of how large the image is actually rendered on screen.
  const IMAGE_ASPECT = 1672 / 941;
  const INNER_FRAME = {
    leftFrac: 14 / 1672,
    topFrac: 15 / 941,
    rightFrac: 1658 / 1672,
    bottomFrac: 924 / 941,
  };

  /**
   * Computes the background image's actual rendered box on screen under
   * background-size:contain -- i.e. the largest rectangle with the
   * image's aspect ratio that fits entirely within the viewport,
   * centered. Then maps the inner-frame fractions onto that box to get
   * exact pixel coordinates for where #player-view-main should sit, so
   * its content never overlaps the background's ornate border.
   */
  // Candle flame glow position, verified by visually overlaying a test
  // bounding box on the source image and adjusting until it matched the
  // actual flame -- the earlier brightness-scan approach had picked up
  // a false-positive reflection on the nearby sword instead.
  const FLAME_GLOW = {
    leftFrac: 0.065, topFrac: 0.788, widthFrac: 0.045, heightFrac: 0.085,
  };

  // Fog spans the lower portion of the scene where the original artwork
  // already shows ground mist (visible across the bottom, more
  // pronounced toward the right pillar). Generous bounds since fog is
  // inherently diffuse -- it doesn't need pixel-precise alignment the
  // way the flame glow (a small bright point) does.
  const FOG_BAND = {
    leftFrac: 0.0, topFrac: 0.78, widthFrac: 1.0, heightFrac: 0.22,
  };

  function applyFrameGeometry() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viewportAspect = vw / vh;

    let renderedWidth, renderedHeight, offsetX, offsetY;
    if (viewportAspect > IMAGE_ASPECT) {
      // Viewport is relatively wider than the image -- image is
      // height-constrained, centered horizontally with bars on the sides.
      renderedHeight = vh;
      renderedWidth = vh * IMAGE_ASPECT;
      offsetX = (vw - renderedWidth) / 2;
      offsetY = 0;
    } else {
      // Viewport is relatively taller/narrower -- image is
      // width-constrained, centered vertically with bars top/bottom.
      renderedWidth = vw;
      renderedHeight = vw / IMAGE_ASPECT;
      offsetX = 0;
      offsetY = (vh - renderedHeight) / 2;
    }

    const innerLeft = offsetX + renderedWidth * INNER_FRAME.leftFrac;
    const innerTop = offsetY + renderedHeight * INNER_FRAME.topFrac;
    const innerRight = offsetX + renderedWidth * INNER_FRAME.rightFrac;
    const innerBottom = offsetY + renderedHeight * INNER_FRAME.bottomFrac;

    main.style.position = 'absolute';
    main.style.left = `${innerLeft}px`;
    main.style.top = `${innerTop}px`;
    main.style.width = `${innerRight - innerLeft}px`;
    main.style.height = `${innerBottom - innerTop}px`;

    // Position the flame glow and fog layers the same way -- mapped onto
    // the actual rendered image box, not the raw viewport, so they stay
    // aligned with the artwork regardless of window size/letterboxing.
    flameGlow.style.left = `${offsetX + renderedWidth * FLAME_GLOW.leftFrac}px`;
    flameGlow.style.top = `${offsetY + renderedHeight * FLAME_GLOW.topFrac}px`;
    flameGlow.style.width = `${renderedWidth * FLAME_GLOW.widthFrac}px`;
    flameGlow.style.height = `${renderedHeight * FLAME_GLOW.heightFrac}px`;

    fog.style.left = `${offsetX + renderedWidth * FOG_BAND.leftFrac}px`;
    fog.style.top = `${offsetY + renderedHeight * FOG_BAND.topFrac}px`;
    fog.style.width = `${renderedWidth * FOG_BAND.widthFrac}px`;
    fog.style.height = `${renderedHeight * FOG_BAND.heightFrac}px`;
  }

  window.addEventListener('resize', applyFrameGeometry);
  applyFrameGeometry();

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /**
   * Renders the combatant list. Expects payload shape:
   * {
   *   round: number,
   *   activeInstanceId: string|null,
   *   combatants: [{ instanceId, label, initiative, isActive, isDead, conditions: [string] }]
   *   -- already sorted by the sender in turn order.
   * }
   */
  function render(payload) {
    waitingState.style.display = 'none';
    main.style.display = '';

    roundNumberEl.textContent = String(payload.round);

    if (!payload.combatants.length) {
      listEl.innerHTML = '<div class="player-view-empty">Encounter je prázdný.</div>';
      return;
    }

    listEl.innerHTML = payload.combatants.map((c) => {
      const rowClasses = [
        'player-view-row',
        c.isActive ? 'player-view-row-active' : '',
        c.isDead ? 'player-view-row-dead' : '',
      ].filter(Boolean).join(' ');

      const conditionsHtml = c.conditions.length
        ? `<div class="player-view-conditions">${c.conditions.map((cond) => `<span class="player-view-condition-tag">${escapeHtml(cond)}</span>`).join('')}</div>`
        : '';

      // Bloodied/critical status icon, sitting between initiative and
      // the name/conditions column -- the app deliberately never sends
      // exact HP numbers to the player view, only this category, so
      // there's nothing more precise to show here even for 'normal'.
      const statusIconHtml = (c.hpStatus === 'bloodied' || c.hpStatus === 'critical')
        ? `<div class="player-view-status-col"><img src="assets/icons/state-${c.hpStatus}.png" alt="${c.hpStatus === 'critical' ? 'Kriticky zraněn' : 'Krvácí'}" title="${c.hpStatus === 'critical' ? 'Kriticky zraněn' : 'Krvácí'}" class="player-view-status-icon" onerror="this.style.display='none'" /></div>`
        : '<div class="player-view-status-col"></div>';

      return `
        <div class="${rowClasses}">
          <div class="player-view-initiative">${c.initiative === null ? '–' : c.initiative}</div>
          ${statusIconHtml}
          <div class="player-view-main-col">
            <div class="player-view-name">
              ${c.isActive ? '<span class="player-view-active-marker">&#9876;</span>' : ''}
              <span class="player-view-name-text">${escapeHtml(c.label)}</span>
              ${c.isDead ? '<span class="player-view-dead-tag">DEAD</span>' : ''}
            </div>
            ${conditionsHtml}
          </div>
        </div>
      `;
    }).join('');

    // Follow the active combatant as the turn order advances. Centering
    // (block: 'center') naturally degrades to aligning at the nearest
    // edge when there isn't enough content above/below to center
    // against -- e.g. the first or last combatant in the list -- so no
    // separate start/end-of-list handling is needed here.
    const activeRow = listEl.querySelector('.player-view-row-active');
    if (activeRow) {
      activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  PlayerViewChannel.onMessage(render);
})();
