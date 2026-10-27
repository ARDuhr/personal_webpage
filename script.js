const modal = document.querySelector('.modal');
const openModalButton = document.querySelector('[data-open-modal]');
const closeModalButton = document.querySelector('[data-close-modal]');
const updatedOn = document.querySelector('#updated-on');
const cursor = document.querySelector('.custom-cursor');

const lastUpdated = new Date(document.lastModified);
updatedOn.textContent = `Updated on: ${lastUpdated.toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric'
})}`;

openModalButton.addEventListener('click', () => {
  modal.showModal();
  modal.append(cursor);
});
closeModalButton.addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => { if (event.target === modal) modal.close(); });
modal.addEventListener('close', () => document.body.prepend(cursor));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal.open) modal.close(); });
document.addEventListener('pointermove', (event) => {
  cursor.style.left = `${event.clientX}px`;
  cursor.style.top = `${event.clientY}px`;
});
