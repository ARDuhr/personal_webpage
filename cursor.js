// Custom square cursor. The system cursor is hidden only while the custom one
// is active (html.cursor-active); leaving the window, switching apps or tabs
// hands control back to the system cursor until the pointer moves again here.
(() => {
  const cursor = document.querySelector('.custom-cursor');
  if (!cursor || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const root = document.documentElement;

  const activate = (event) => {
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
    // An open <dialog> sits in the top layer; the cursor must live inside it to stay visible.
    const host = document.querySelector('dialog[open]') || document.body;
    if (cursor.parentElement !== host) host.append(cursor);
    root.classList.add('cursor-active');
  };
  const deactivate = () => root.classList.remove('cursor-active');

  window.addEventListener('pointermove', activate, { passive: true });
  window.addEventListener('pointerdown', activate, { passive: true });
  document.addEventListener('mouseout', (event) => { if (!event.relatedTarget) deactivate(); });
  window.addEventListener('blur', deactivate);
  document.addEventListener('visibilitychange', () => { if (document.hidden) deactivate(); });
  // When a dialog closes, bring the cursor back out of it (watching the `open`
  // attribute is more dependable than the dialog's `close` event).
  const observer = new MutationObserver(() => {
    const parent = cursor.parentElement;
    if (parent instanceof HTMLDialogElement && !parent.open) document.body.append(cursor);
  });
  document.querySelectorAll('dialog').forEach((dialog) => observer.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
})();
