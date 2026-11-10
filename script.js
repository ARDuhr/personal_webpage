const modal = document.querySelector('.modal');
const openModalButton = document.querySelector('[data-open-modal]');
const closeModalButton = document.querySelector('[data-close-modal]');
const updatedOn = document.querySelector('#updated-on');

const lastUpdated = new Date(document.lastModified);
updatedOn.textContent = `LAST UPDATED: ${new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric'
}).format(lastUpdated).toUpperCase()}`;

openModalButton.addEventListener('click', () => modal.showModal());
closeModalButton.addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => { if (event.target === modal) modal.close(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal.open) modal.close(); });
