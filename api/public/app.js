const STORAGE_KEY = 'harbor-session';
const statusLabels = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
const priorityLabels = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const state = { token: null, user: null, tickets: [], comments: [], selectedId: null, filter: 'all', search: '', tenantName: 'Your workspace', users: [] };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const authView = $('#auth-view');
const appView = $('#app-view');
const authForm = $('#auth-form');
const ticketDialog = $('#ticket-dialog');
let toastTimer;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function initials(value = '') {
  return value.trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'H';
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function relativeTime(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(value);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) signOut();
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

function setAuthMode(mode) {
  const isSignup = mode === 'signup';
  $$('.auth-tab').forEach((tab) => {
    const selected = tab.dataset.authMode === mode;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
  $$('.signup-only').forEach((field) => { field.hidden = !isSignup; });
  $('#auth-kicker').textContent = isSignup ? 'A GOOD PLACE TO START' : 'WELCOME BACK';
  $('#auth-title').textContent = isSignup ? 'Let’s make room.' : 'Good to see you.';
  $('#auth-copy').textContent = isSignup ? 'Create a private workspace for the people you help.' : 'Sign in to pick up where your team left off.';
  $('#auth-submit-label').textContent = isSignup ? 'Create workspace' : 'Sign in';
  authForm.elements.password.autocomplete = isSignup ? 'new-password' : 'current-password';
  authForm.elements.password.minLength = isSignup ? 8 : 1;
  authForm.elements.tenantName.required = isSignup;
  authForm.elements.tenantSlug.required = isSignup;
  $('#auth-error').hidden = true;
}

function showAuth() {
  appView.hidden = true;
  authView.hidden = false;
  setAuthMode('login');
}

function showApp() {
  authView.hidden = true;
  appView.hidden = false;
  const email = state.user?.email || 'Account';
  const mark = initials(state.tenantName);
  $('#workspace-name').textContent = state.tenantName;
  $('#workspace-avatar').textContent = mark;
  $('#profile-name').textContent = email;
  $('#profile-role').textContent = state.user?.role || 'Member';
  $('#profile-avatar').textContent = initials(email);
  $('#topbar-avatar').textContent = initials(email);
}

function saveSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: state.token, user: state.user, tenantName: state.tenantName }));
}

function signOut(clearStorage = true) {
  state.token = null;
  state.user = null;
  state.tickets = [];
  state.selectedId = null;
  if (clearStorage) localStorage.removeItem(STORAGE_KEY);
  showAuth();
}

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function ticketMatchesFilter(ticket) {
  return state.filter === 'all' || ticket.status === state.filter;
}

function ticketMatchesSearch(ticket) {
  const query = state.search.trim().toLowerCase();
  return !query || [ticket.subject, ticket.description, ticket.id, ticket.status, ticket.priority].some((value) => String(value || '').toLowerCase().includes(query));
}

function sortTickets(tickets) {
  return [...tickets].sort((first, second) => new Date(second.updated_at || second.created_at) - new Date(first.updated_at || first.created_at));
}

function renderMetrics() {
  const counts = { open: 0, in_progress: 0, resolved: 0 };
  state.tickets.forEach((ticket) => { if (counts[ticket.status] !== undefined) counts[ticket.status] += 1; });
  $('#metric-open').textContent = counts.open;
  $('#metric-progress').textContent = counts.in_progress;
  $('#metric-resolved').textContent = counts.resolved;
  $('#metric-total').textContent = state.tickets.length;
  $('#nav-open-count').textContent = counts.open;
  $('#count-all').textContent = state.tickets.length;
  $('#count-open').textContent = counts.open;
  $('#count-progress').textContent = counts.in_progress;
}

function renderTickets() {
  const container = $('#ticket-list');
  const tickets = sortTickets(state.tickets).filter((ticket) => ticketMatchesFilter(ticket) && ticketMatchesSearch(ticket));
  if (!tickets.length) {
    const hasFilters = state.filter !== 'all' || state.search;
    container.innerHTML = `<div class="list-empty">${hasFilters ? 'No conversations match that search.' : 'A quiet inbox. Create a ticket when something needs attention.'}</div>`;
  } else {
    container.innerHTML = tickets.map((ticket) => {
      const selected = ticket.id === state.selectedId;
      const description = ticket.description || 'No details added yet.';
      const shortId = String(ticket.id).split('-')[0].toUpperCase();
      return `<article class="ticket-row${selected ? ' is-selected' : ''}" data-ticket-id="${escapeHtml(ticket.id)}" tabindex="0" role="button" aria-label="Open ticket: ${escapeHtml(ticket.subject)}" aria-pressed="${selected}">
        <strong class="ticket-subject">${escapeHtml(ticket.subject)}</strong><span class="ticket-time">${escapeHtml(relativeTime(ticket.updated_at || ticket.created_at))}</span>
        <span class="ticket-preview">${escapeHtml(description)}</span>
        <span class="ticket-meta"><span class="status-pill status-${escapeHtml(ticket.status)}">${escapeHtml(statusLabels[ticket.status] || ticket.status)}</span><span class="priority-pill priority-${escapeHtml(ticket.priority)}">${escapeHtml(priorityLabels[ticket.priority] || ticket.priority)} priority</span><span class="ticket-id">#${escapeHtml(shortId)}</span></span>
      </article>`;
    }).join('');
  }
  $('#list-foot').textContent = `${tickets.length} ${tickets.length === 1 ? 'conversation' : 'conversations'}`;
  $$('.filter-tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.filter === state.filter));
}

function renderDetail() {
  const ticket = state.tickets.find((item) => item.id === state.selectedId);
  const detail = $('#ticket-detail');
  if (!ticket) {
    detail.innerHTML = '<div class="detail-empty"><div class="empty-illustration"><span>↗</span><i></i></div><p class="eyebrow">ONE THING AT A TIME</p><h2>Your inbox, in focus.</h2><p>Choose a conversation to see the details and keep things moving.</p></div>';
    return;
  }
  const userById = new Map(state.users.map((user) => [user.id, user]));
  const creator = userById.get(ticket.created_by);
  const assignee = userById.get(ticket.assigned_to);
  const comments = [...state.comments].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const commentMarkup = comments.length ? comments.map((comment) => {
    const author = userById.get(comment.author_id);
    const label = author?.email || (comment.author_id === state.user?.sub ? state.user.email : 'Workspace member');
    return `<article class="comment"><span class="comment-avatar">${escapeHtml(initials(label))}</span><div class="comment-body"><div class="comment-meta"><strong>${escapeHtml(label)}</strong><time>${escapeHtml(formatDate(comment.created_at))}</time></div><p class="comment-text">${escapeHtml(comment.body)}</p></div></article>`;
  }).join('') : '<p class="no-comments">No replies yet. Start the conversation below.</p>';
  const assigneeValue = ticket.assigned_to ? `<span>Assigned to ${escapeHtml(assignee?.email || 'teammate')}</span>` : '';
  const canManage = state.user?.role === 'admin';
  const deleteButton = canManage ? '<button class="delete-ticket" id="delete-ticket" type="button">Delete ticket</button>' : '';
  detail.innerHTML = `<header class="detail-head"><div class="detail-overline"><span>CONVERSATION <strong>#${escapeHtml(String(ticket.id).split('-')[0].toUpperCase())}</strong></span><time>Updated ${escapeHtml(formatDate(ticket.updated_at || ticket.created_at))}</time></div><h2>${escapeHtml(ticket.subject)}</h2>${ticket.description ? `<p class="detail-description">${escapeHtml(ticket.description)}</p>` : ''}<div class="detail-controls"><label class="visually-hidden" for="ticket-status">Status</label><select id="ticket-status" aria-label="Ticket status">${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}"${ticket.status === value ? ' selected' : ''}>${label}</option>`).join('')}</select><label class="visually-hidden" for="ticket-priority">Priority</label><select id="ticket-priority" aria-label="Ticket priority">${Object.entries(priorityLabels).map(([value, label]) => `<option value="${value}"${ticket.priority === value ? ' selected' : ''}>${label} priority</option>`).join('')}</select>${assigneeValue}${deleteButton}</div></header><section class="conversation"><p class="conversation-label">${comments.length ? `${comments.length} ${comments.length === 1 ? 'REPLY' : 'REPLIES'}` : 'CONVERSATION'}</p>${commentMarkup}</section><form class="reply-box" id="reply-form"><label class="visually-hidden" for="reply-text">Write a reply</label><textarea id="reply-text" name="body" maxlength="5000" required placeholder="Write a thoughtful reply..."></textarea><div class="reply-actions"><span class="reply-hint">Replying as ${escapeHtml(state.user?.email || 'you')}</span><button class="button button-primary" type="submit">Send reply <span aria-hidden="true">↗</span></button></div></form>`;
  $('#ticket-status').addEventListener('change', (event) => updateTicket(ticket.id, { status: event.target.value }));
  $('#ticket-priority').addEventListener('change', (event) => updateTicket(ticket.id, { priority: event.target.value }));
  $('#reply-form').addEventListener('submit', submitReply);
  $('#delete-ticket')?.addEventListener('click', () => deleteTicket(ticket));
}

async function loadTickets() {
  const data = await api('/api/v1/tickets');
  state.tickets = data.tickets || [];
  renderMetrics();
  renderTickets();
  renderDetail();
}

async function loadUsers() {
  if (state.user?.role !== 'admin') return;
  try {
    const data = await api('/api/v1/users');
    state.users = data.users || [];
  } catch (error) {
    if (!String(error.message).includes('Forbidden')) console.warn('Could not load workspace members', error);
  }
}

async function selectTicket(id) {
  state.selectedId = id;
  renderTickets();
  renderDetail();
  try {
    const data = await api(`/api/v1/tickets/${encodeURIComponent(id)}/comments`);
    if (state.selectedId !== id) return;
    state.comments = data.comments || [];
    await loadUsers();
    renderDetail();
  } catch (error) {
    notify(error.message);
  }
}

async function updateTicket(id, changes) {
  try {
    const data = await api(`/api/v1/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) });
    state.tickets = state.tickets.map((ticket) => ticket.id === id ? data.ticket : ticket);
    renderMetrics();
    renderTickets();
    renderDetail();
    notify('Ticket updated.');
  } catch (error) {
    notify(error.message);
    renderDetail();
  }
}

async function submitReply(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = new FormData(form).get('body').trim();
  if (!body) return;
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  try {
    const data = await api(`/api/v1/tickets/${encodeURIComponent(state.selectedId)}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    state.comments.push(data.comment);
    await loadTickets();
    await loadUsers();
    renderDetail();
    notify('Reply sent.');
  } catch (error) {
    notify(error.message);
    button.disabled = false;
  }
}

async function deleteTicket(ticket) {
  if (!window.confirm(`Delete “${ticket.subject}”? This also removes its replies.`)) return;
  try {
    await api(`/api/v1/tickets/${encodeURIComponent(ticket.id)}`, { method: 'DELETE' });
    state.tickets = state.tickets.filter((item) => item.id !== ticket.id);
    state.selectedId = null;
    state.comments = [];
    renderMetrics();
    renderTickets();
    renderDetail();
    notify('Ticket deleted.');
  } catch (error) {
    notify(error.message);
  }
}

async function openWorkspace() {
  showApp();
  try {
    const profile = await api('/api/v1/auth/me');
    if (profile?.user) state.user = { ...state.user, ...profile.user };
    showApp();
    await Promise.all([loadTickets(), loadUsers()]);
    renderDetail();
  } catch (error) {
    if (state.token) notify(error.message);
  }
}

$$('.auth-tab').forEach((tab) => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(authForm);
  const signup = $('.auth-tab[data-auth-mode="signup"]').getAttribute('aria-selected') === 'true';
  const button = $('.auth-submit', authForm);
  const errorElement = $('#auth-error');
  errorElement.hidden = true;
  button.disabled = true;
  const payload = signup
    ? { tenantName: form.get('tenantName').trim(), tenantSlug: form.get('tenantSlug').trim().toLowerCase(), email: form.get('email').trim(), password: form.get('password') }
    : { tenantSlug: form.get('tenantSlug').trim().toLowerCase(), email: form.get('email').trim(), password: form.get('password') };
  try {
    const data = await api(`/api/v1/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', body: JSON.stringify(payload) });
    state.token = data.token;
    state.user = data.user;
    state.tenantName = signup ? payload.tenantName : payload.tenantSlug;
    saveSession();
    await openWorkspace();
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  } finally {
    button.disabled = false;
  }
});

$$('.filter-tab').forEach((tab) => tab.addEventListener('click', () => {
  state.filter = tab.dataset.filter;
  renderTickets();
}));
$$('.nav-item').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter || 'all';
  renderTickets();
  $$('.filter-tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.filter === state.filter));
}));
$('#search-input').addEventListener('input', (event) => {
  state.search = event.target.value;
  renderTickets();
});
$('#ticket-list').addEventListener('click', (event) => {
  const row = event.target.closest('[data-ticket-id]');
  if (row) void selectTicket(row.dataset.ticketId);
});
$('#ticket-list').addEventListener('keydown', (event) => {
  const row = event.target.closest('[data-ticket-id]');
  if (row && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    void selectTicket(row.dataset.ticketId);
  }
});
$('#refresh-button').addEventListener('click', async () => {
  try {
    await loadTickets();
    notify('Inbox is up to date.');
  } catch (error) {
    notify(error.message);
  }
});
$('#profile-button').addEventListener('click', () => signOut());
$('#new-ticket-button').addEventListener('click', () => {
  $('#ticket-error').hidden = true;
  ticketDialog.showModal();
  setTimeout(() => $('#ticket-form').elements.subject.focus(), 0);
});
$('.dialog-close').addEventListener('click', () => ticketDialog.close());
$('.dialog-cancel').addEventListener('click', () => ticketDialog.close());
ticketDialog.addEventListener('click', (event) => {
  if (event.target === ticketDialog) ticketDialog.close();
});
$('#ticket-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  $('#ticket-error').hidden = true;
  try {
    const response = await api('/api/v1/tickets', { method: 'POST', body: JSON.stringify({ subject: data.get('subject').trim(), description: data.get('description').trim(), priority: data.get('priority') }) });
    ticketDialog.close();
    form.reset();
    state.tickets.unshift(response.ticket);
    state.filter = 'all';
    state.selectedId = response.ticket.id;
    state.comments = [];
    renderMetrics();
    renderTickets();
    renderDetail();
    notify('Your ticket is in the inbox.');
  } catch (error) {
    const errorElement = $('#ticket-error');
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  } finally {
    button.disabled = false;
  }
});

async function boot() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (!saved?.token || !saved?.user) {
    showAuth();
    return;
  }
  state.token = saved.token;
  state.user = saved.user;
  state.tenantName = saved.tenantName || saved.user.email.split('@')[1] || 'Your workspace';
  await openWorkspace();
}

boot();
