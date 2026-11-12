export function draftChannel(receive) {
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('codeforge-drafts') : null;
  const onStorage = event => {
    if (event.key === 'codeforge-draft-notification' && event.newValue) {
      try { receive(JSON.parse(event.newValue)); } catch { /* Ignore unrelated/corrupt notifications. */ }
    }
  };
  if (channel) channel.onmessage = event => receive(event.data);
  window.addEventListener('storage', onStorage);
  return {
    send(data) {
      channel?.postMessage(data);
      if (!channel) try { localStorage.setItem('codeforge-draft-notification', JSON.stringify({ ...data, nonce: Math.random() })); } catch { /* Focus recheck remains available. */ }
    },
    close() { channel?.close(); window.removeEventListener('storage', onStorage); },
  };
}
