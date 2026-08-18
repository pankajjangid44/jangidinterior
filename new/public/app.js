const galleryGrid = document.querySelector('#gallery-grid');
const projectTemplate = document.querySelector('#project-template');
const filterButtons = [...document.querySelectorAll('.filter-button')];
let allProjects = [];
let activeFilter = 'All';

const esc = (value) => String(value ?? '');

async function request(url, options = {}) {
  const response = await fetch(url, options);
  let payload = {};
  try { payload = await response.json(); } catch { /* empty response */ }
  if (!response.ok) throw new Error(payload.error || 'Something went wrong. Please try again.');
  return payload;
}

// Lightbox Modal Functions
const lightbox = document.querySelector('#image-lightbox');
const lightboxImg = document.querySelector('#lightbox-img');
const lightboxCaption = document.querySelector('#lightbox-caption');
const lightboxClose = document.querySelector('.lightbox-close');

function openLightbox(src, title) {
  if (!lightbox || !lightboxImg) return;
  lightboxImg.src = src;
  lightboxCaption.textContent = title;
  lightbox.setAttribute('aria-hidden', 'false');
}

function closeLightbox() {
  if (!lightbox) return;
  lightbox.setAttribute('aria-hidden', 'true');
  if (lightboxImg) lightboxImg.src = '';
}

if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
if (lightbox) {
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lightbox && lightbox.getAttribute('aria-hidden') === 'false') {
    closeLightbox();
  }
});

function renderGallery() {
  if (!galleryGrid) return;
  const projects = activeFilter === 'All' ? allProjects : allProjects.filter((project) => project.category === activeFilter);
  galleryGrid.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'gallery-loading';
    empty.textContent = 'No projects in this collection yet.';
    galleryGrid.append(empty);
    return;
  }
  projects.forEach((project, index) => {
    const card = projectTemplate.content.cloneNode(true);
    const article = card.querySelector('.project-card');
    const img = card.querySelector('img');
    img.src = project.src;
    img.alt = project.title;
    img.onerror = () => article.remove();
    card.querySelector('h3').textContent = project.title;
    
    const catSpan = card.querySelector('.project-category');
    if (catSpan) catSpan.textContent = project.category;
    
    article.style.animationDelay = `${Math.min(index * 45, 250)}ms`;

    // Click to view full image
    article.addEventListener('click', () => {
      openLightbox(project.src, project.title);
    });

    galleryGrid.append(card);
  });
}

async function loadPublicGallery() {
  try {
    const { gallery } = await request('/api/gallery');
    allProjects = gallery;
    renderGallery();
  } catch {
    if (galleryGrid) galleryGrid.innerHTML = '<p class="gallery-loading">The gallery is unavailable right now.</p>';
  }
}

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((filter) => filter.classList.toggle('active', filter === button));
    renderGallery();
  });
});

const yearEl = document.querySelector('#year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

const navToggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.main-nav');
if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  }));
}

const enquiryForm = document.querySelector('#enquiry-form');
const enquiryStatus = document.querySelector('#form-status');
if (enquiryForm) {
  enquiryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = enquiryForm.querySelector('button[type="submit"]');
    const fields = new FormData(enquiryForm);
    const payload = Object.fromEntries(fields.entries());
    if (enquiryStatus) {
      enquiryStatus.classList.remove('error');
      enquiryStatus.textContent = 'Sending your enquiry…';
    }
    submitButton.disabled = true;
    try {
      const result = await request('/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (enquiryStatus) enquiryStatus.textContent = result.message;
      enquiryForm.reset();
    } catch (error) {
      if (enquiryStatus) {
        enquiryStatus.classList.add('error');
        enquiryStatus.textContent = error.message;
      }
    } finally {
      submitButton.disabled = false;
    }
  });
}

const dialog = document.querySelector('#admin-dialog');
const loginView = document.querySelector('#admin-login-view');
const dashboardView = document.querySelector('#admin-dashboard-view');
const loginForm = document.querySelector('#login-form');
const loginStatus = document.querySelector('.login-status');
const uploadForm = document.querySelector('#upload-form');
const uploadStatus = document.querySelector('.upload-status');
const adminGallery = document.querySelector('#admin-gallery');
const enquiriesList = document.querySelector('#enquiries-list');
const enquiryCount = document.querySelector('#enquiry-count');

function setAdminView(authenticated) {
  if (loginView) loginView.hidden = authenticated;
  if (dashboardView) dashboardView.hidden = !authenticated;
}

async function getSession() {
  const { authenticated } = await request('/api/admin/session');
  return authenticated;
}

async function openAdmin() {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  if (loginStatus) loginStatus.textContent = '';
  try {
    const authenticated = await getSession();
    setAdminView(authenticated);
    if (authenticated) await refreshDashboard();
  } catch {
    setAdminView(false);
  }
}

const adminOpenBtn = document.querySelector('#admin-open');
const adminCloseBtn = document.querySelector('#admin-close');
if (adminOpenBtn) adminOpenBtn.addEventListener('click', openAdmin);
if (adminCloseBtn) adminCloseBtn.addEventListener('click', () => dialog && dialog.close());

if (dialog) {
  dialog.addEventListener('click', (event) => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector('button');
    if (loginStatus) {
      loginStatus.classList.remove('error');
      loginStatus.textContent = 'Signing in…';
    }
    button.disabled = true;
    try {
      await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(loginForm).entries())) });
      loginForm.reset();
      setAdminView(true);
      await refreshDashboard();
    } catch (error) {
      if (loginStatus) {
        loginStatus.classList.add('error');
        loginStatus.textContent = error.message;
      }
    } finally {
      button.disabled = false;
    }
  });
}

function adminPhotoCard(photo) {
  const card = document.createElement('article');
  card.className = 'admin-photo';
  const image = document.createElement('img');
  image.src = photo.src;
  image.alt = photo.title;
  image.style.cursor = 'pointer';
  image.addEventListener('click', () => openLightbox(photo.src, photo.title));

  const deleteButton = document.createElement('button');
  deleteButton.className = 'delete-photo';
  deleteButton.type = 'button';
  deleteButton.textContent = '×';
  deleteButton.addEventListener('click', () => deletePhoto(photo));
  
  const info = document.createElement('div');
  info.className = 'admin-photo-info';
  const title = document.createElement('p');
  title.textContent = photo.title;
  const category = document.createElement('span');
  category.textContent = photo.category;
  info.append(title, category);
  card.append(image, deleteButton, info);
  return card;
}

function renderAdminGallery(gallery) {
  if (!adminGallery) return;
  adminGallery.replaceChildren();
  if (!gallery.length) {
    adminGallery.innerHTML = '<p class="empty-state">No gallery photos published.</p>';
    return;
  }
  gallery.forEach((photo) => adminGallery.append(adminPhotoCard(photo)));
}

function formatDate(dateText) {
  const date = new Date(dateText);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderEnquiries(enquiries) {
  if (!enquiriesList) return;
  enquiriesList.replaceChildren();
  if (enquiryCount) enquiryCount.textContent = enquiries.length;
  if (!enquiries.length) {
    enquiriesList.innerHTML = '<p class="empty-state">No active client enquiries.</p>';
    return;
  }
  enquiries.forEach((enquiry) => {
    const item = document.createElement('article');
    item.className = 'enquiry-item';
    const about = document.createElement('div');
    about.innerHTML = `<p class="enquiry-name"></p><p class="enquiry-date"></p>`;
    about.querySelector('.enquiry-name').textContent = esc(enquiry.name);
    about.querySelector('.enquiry-date').textContent = `Received ${formatDate(enquiry.createdAt)}`;
    
    const contact = document.createElement('div');
    contact.className = 'enquiry-contact';
    const phone = document.createElement('a');
    phone.href = `tel:${esc(enquiry.phone).replace(/[^+\d]/g, '')}`;
    phone.textContent = esc(enquiry.phone);
    contact.append(phone);
    if (enquiry.email) {
      const email = document.createElement('a');
      email.href = `mailto:${esc(enquiry.email)}`;
      email.textContent = esc(enquiry.email);
      contact.append(email);
    }
    
    const project = document.createElement('div');
    project.className = 'enquiry-project';
    const label = document.createElement('p');
    label.className = 'enquiry-label';
    label.textContent = 'Project';
    const values = document.createElement('p');
    values.textContent = [enquiry.projectType, enquiry.budget, enquiry.city].filter(Boolean).join(' · ') || 'Not specified';
    project.append(label, values);
    
    const message = document.createElement('p');
    message.className = 'enquiry-message';
    message.textContent = esc(enquiry.message);
    
    item.append(about, contact, project, message);
    enquiriesList.append(item);
  });
}

async function refreshDashboard() {
  const [galleryResult, enquiriesResult] = await Promise.all([
    request('/api/admin/gallery'),
    request('/api/admin/enquiries')
  ]);
  renderAdminGallery(galleryResult.gallery);
  renderEnquiries(enquiriesResult.enquiries);
}

async function deletePhoto(photo) {
  if (!window.confirm(`Remove “${photo.title}” from the public gallery?`)) return;
  try {
    await request(`/api/admin/gallery/${encodeURIComponent(photo.id)}`, { method: 'DELETE' });
    await Promise.all([refreshDashboard(), loadPublicGallery()]);
  } catch (error) {
    window.alert(error.message);
  }
}

if (uploadForm) {
  const fileInput = uploadForm.querySelector('input[type="file"]');
  const fileInputText = uploadForm.querySelector('.file-input span');
  if (fileInput && fileInputText) {
    fileInput.addEventListener('change', () => { fileInputText.textContent = fileInput.files[0]?.name || 'Choose image'; });
  }

  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = uploadForm.querySelector('button[type="submit"]');
    if (uploadStatus) {
      uploadStatus.classList.remove('error');
      uploadStatus.textContent = 'Publishing photo…';
    }
    button.disabled = true;
    try {
      await request('/api/admin/gallery', { method: 'POST', body: new FormData(uploadForm) });
      uploadForm.reset();
      if (fileInputText) fileInputText.textContent = 'Choose image';
      if (uploadStatus) uploadStatus.textContent = 'Photo published successfully.';
      await Promise.all([refreshDashboard(), loadPublicGallery()]);
    } catch (error) {
      if (uploadStatus) {
        uploadStatus.classList.add('error');
        uploadStatus.textContent = error.message;
      }
    } finally {
      button.disabled = false;
    }
  });
}

document.querySelectorAll('.admin-tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.admin-tab').forEach((item) => item.classList.toggle('active', item === tab));
  document.querySelectorAll('.admin-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${tab.dataset.panel}`));
}));

const logoutBtn = document.querySelector('#logout-button');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await request('/api/admin/logout', { method: 'POST' });
    setAdminView(false);
    if (loginStatus) loginStatus.textContent = 'You have been signed out.';
  });
}

loadPublicGallery();