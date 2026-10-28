const modal = document.querySelector('.modal');
const openModalButton = document.querySelector('[data-open-modal]');
const closeModalButton = document.querySelector('[data-close-modal]');
const updatedOn = document.querySelector('#updated-on');
const cursor = document.querySelector('.custom-cursor');
const usesFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const modalCursor = document.createElement('div');

modalCursor.setAttribute('aria-hidden', 'true');
Object.assign(modalCursor.style, {
  position: 'fixed', zIndex: '1000', width: '20px', height: '20px',
  background: '#fff', pointerEvents: 'none', transform: 'translate(-50%, -50%)'
});

const lastUpdated = new Date(document.lastModified);
updatedOn.textContent = `Updated on: ${lastUpdated.toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric'
})}`;

openModalButton.addEventListener('click', () => {
  modal.showModal();
  if (usesFinePointer) modal.append(modalCursor);
});
closeModalButton.addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => { if (event.target === modal) modal.close(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal.open) modal.close(); });
document.addEventListener('pointermove', (event) => {
  cursor.style.left = `${event.clientX}px`;
  cursor.style.top = `${event.clientY}px`;
  if (usesFinePointer) {
    modalCursor.style.left = `${event.clientX}px`;
    modalCursor.style.top = `${event.clientY}px`;
  }
});
