/**
 * player-view-channel.js
 * -----------------------------------------------------------------------
 * Thin wrapper around BroadcastChannel for live-syncing a reduced view of
 * the encounter to a separate "player view" window/tab (intended to be
 * captured in OBS and shown to players/viewers). Same-origin, same-device
 * only -- this never touches a server or the network, just the browser's
 * built-in same-origin messaging between tabs/windows.
 *
 * Both index.html (the DM tracker) and player-view.html load this file
 * and open a channel with the same name, so postMessage-style broadcasts
 * sent by one are received by the other automatically.
 *
 * Usage (sender, in ui.js):
 *   PlayerViewChannel.send({ round, activeInstanceId, combatants: [...] });
 *
 * Usage (receiver, in player-view.js):
 *   PlayerViewChannel.onMessage((payload) => { ...render payload... });
 * -----------------------------------------------------------------------
 */

const PlayerViewChannel = (() => {
  const CHANNEL_NAME = 'dnd-tracker:player-view';
  let channel = null;

  function getChannel() {
    if (channel) return channel;
    if (typeof BroadcastChannel === 'undefined') {
      // Extremely old/unusual browsers only -- BroadcastChannel has had
      // universal support in evergreen browsers for years. No fallback
      // transport is implemented since this feature is explicitly
      // same-device/same-browser only; if it's unavailable, the player
      // view simply won't receive live updates, which fails safely
      // (the window just shows its "waiting for connection" state).
      console.error('BroadcastChannel is not supported in this browser -- Player View cannot sync.');
      return null;
    }
    channel = new BroadcastChannel(CHANNEL_NAME);
    return channel;
  }

  /** Sends a payload to the other end (DM tracker -> player view). */
  function send(payload) {
    const ch = getChannel();
    if (!ch) return;
    ch.postMessage(payload);
  }

  /** Registers a handler for incoming payloads (player view side). */
  function onMessage(handler) {
    const ch = getChannel();
    if (!ch) return;
    ch.addEventListener('message', (event) => handler(event.data));
  }

  return { send, onMessage };
})();
