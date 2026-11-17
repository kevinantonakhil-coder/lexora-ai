'use strict';

const app = document.getElementById('app');
const state = { user: null, csrf: null, cases: [], selectedCase: null, view: 'overview', error: null, loading: false, aiConfig: null, aiTest: null, aiUsage: [], aiStatus: null, legalSources: [], auditLog: null };
const jurisdictions = [
  ['UNKNOWN', 'Not specified'], ['UAE_FEDERAL', 'UAE federal'], ['DUBAI_LOCAL', 'Dubai local'],
  ['ABU_DHABI_LOCAL', 'Abu Dhabi local'], ['SHARJAH_LOCAL', 'Sharjah local'], ['AJMAN_LOCAL', 'Ajman local'],
  ['UMM_AL_QUWAIN_LOCAL', 'Umm Al Quwain local'], ['FUJAIRAH_LOCAL', 'Fujairah local'],
  ['RAK_LOCAL', 'Ras Al Khaimah local'], ['DIFC', 'DIFC'], ['ADGM', 'ADGM']
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatDate(value) {
  if (!value) return 'Not specified';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function formatTimestamp(value) {
  if (!value) return 'Unknown time';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

function message(text, type = 'error') {
  state.error = text ? { text, type } : null;
  render();
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  let response;
  try {
    response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  } catch {
    throw new Error('LEXORA could not reach its local service. Check that the server is running.');
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && state.user) {
    state.user = null;
    state.csrf = null;
    state.selectedCase = null;
    render();
  }
  if (!response.ok) throw new Error(payload.error?.message || `Request failed (${response.status}).`);
  return payload;
}

function setLoading(value) {
  state.loading = value;
  render();
}

function jurisdictionOptions(selected = 'UNKNOWN') {
  return jurisdictions.map(([value, label]) =>
    `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

function renderAuth() {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-brand">
        <div class="brand-lockup"><span class="brand-mark">L</span><span>LEXORA</span></div>
        <div>
          <p class="eyebrow">LEGAL INTELLIGENCE WORKSPACE</p>
          <h1>Research with clarity.<br><em>Reason with evidence.</em></h1>
          <p class="auth-copy">A private, source-conscious space to organise legal matters and review documents. Analysis is transparent about its limits.</p>
        </div>
        <p class="auth-foot">INDEPENDENT PROJECT · LOCAL DEMONSTRATION</p>
      </section>
      <section class="auth-form-wrap">
        <form id="auth-form" class="auth-form">
          <p class="eyebrow" id="auth-mode-label">YOUR WORKSPACE</p>
          <h2 id="auth-heading">Welcome back</h2>
          <p class="muted" id="auth-subheading">Sign in to continue to your matters.</p>
          <label>Email address<input name="email" type="email" autocomplete="email" required maxlength="254"></label>
          <label>Password<input name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="128"><span class="field-help">Use at least 12 characters.</span></label>
          <div id="bootstrap-field"></div>
          <div id="auth-error"></div>
          <button class="button button-primary full-width" type="submit">Sign in <span aria-hidden="true">→</span></button>
          <p class="auth-switch"><span id="auth-switch-text">New to LEXORA?</span> <button type="button" class="link-button" id="auth-toggle">Create account</button></p>
          <p class="auth-notice">Your local demonstration data is stored in this project folder. Do not upload confidential or sensitive documents.</p>
        </form>
      </section>
    </main>`;
  const form = document.getElementById('auth-form');
  let registering = false;
  document.getElementById('auth-toggle').addEventListener('click', () => {
    registering = !registering;
    document.getElementById('auth-mode-label').textContent = registering ? 'CREATE YOUR WORKSPACE' : 'YOUR WORKSPACE';
    document.getElementById('auth-heading').textContent = registering ? 'Create your account' : 'Welcome back';
    document.getElementById('auth-subheading').textContent = registering ? 'Start with a private, local workspace.' : 'Sign in to continue to your matters.';
    document.getElementById('auth-toggle').textContent = registering ? 'Sign in' : 'Create account';
    document.getElementById('auth-switch-text').textContent = registering ? 'Already have an account?' : 'New to LEXORA?';
    form.querySelector('button[type="submit"]').innerHTML = `${registering ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span>`;
    form.querySelector('[name="password"]').autocomplete = registering ? 'new-password' : 'current-password';
    document.getElementById('bootstrap-field').innerHTML = registering
      ? '<label>One-time administrator setup token (optional)<input name="bootstrapToken" type="password" autocomplete="off" maxlength="256"><span class="field-help">Only enter a private bootstrap token supplied by the workspace owner. This field is not saved or displayed.</span></label>'
      : '';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    document.getElementById('auth-error').innerHTML = '';
    const fields = Object.fromEntries(new FormData(form));
    try {
      const result = await api(`/api/v1/auth/${registering ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(fields) });
      state.user = result.user;
      state.csrf = result.csrfToken;
      state.error = null;
      await loadCases();
    } catch (error) {
      document.getElementById('auth-error').innerHTML = `<p class="inline-error" role="alert">${escapeHtml(error.message)}</p>`;
      button.disabled = false;
    }
  });
}

function renderShell(content) {
  const active = (view) => state.view === view ? ' active' : '';
  app.innerHTML = `
    <div class="workspace">
      <aside class="sidebar">
        <a class="brand-lockup" href="#" data-view="overview"><span class="brand-mark">L</span><span>LEXORA<small>LEGAL INTELLIGENCE</small></span></a>
        <div class="workspace-label">WORKSPACE</div>
        <nav class="navigation" aria-label="Main navigation">
          <button data-view="overview" class="nav-item${active('overview')}"><span>◫</span> Overview</button>
          <button data-view="cases" class="nav-item${active('cases')}"><span>▤</span> My matters</button>
          <button data-view="research" class="nav-item${active('research')}"><span>⌕</span> Legal research</button>
          ${state.user.role === 'admin' ? `<button data-view="legal-admin" class="nav-item${active('legal-admin')}"><span>§</span> Legal sources</button>` : ''}
          ${state.user.role === 'admin' ? `<button data-view="audit-admin" class="nav-item${active('audit-admin')}"><span>◷</span> Audit log</button>` : ''}
          ${state.user.role === 'admin' ? `<button data-view="ai-admin" class="nav-item${active('ai-admin')}"><span>⚙</span> AI providers</button>` : ''}
        </nav>
        <div class="sidebar-rule"></div>
        <div class="workspace-label">YOUR MATTERS <button class="small-plus" data-action="new-case" aria-label="Create matter">+</button></div>
        <div class="sidebar-cases">${state.cases.slice(0, 6).map((item) =>
          `<button class="matter-link ${state.selectedCase?.id === item.id ? 'selected' : ''}" data-case="${item.id}"><span class="matter-dot"></span><span>${escapeHtml(item.title)}</span></button>`
        ).join('') || '<p class="sidebar-empty">Your matters will appear here.</p>'}</div>
        <div class="sidebar-bottom">
          <div class="local-status"><span class="status-dot"></span><span><b>Local workspace</b><small>${state.aiStatus?.configuredProviders?.includes('gemini') ? 'Gemini configured' : 'Gemini not configured'} · ${state.aiStatus?.ml?.status === 'loaded' ? 'ML model loaded' : 'ML model loads on first search'} · ${state.aiStatus?.legalCorpus?.attestedVersions ? `${state.aiStatus.legalCorpus.attestedVersions} reviewed source versions` : 'no reviewed legal sources'}</small></span></div>
          <div class="profile"><div class="avatar">${escapeHtml(state.user.email.slice(0, 1).toUpperCase())}</div><div class="profile-text"><strong>${escapeHtml(state.user.email)}</strong><small>${escapeHtml(state.user.role)}</small></div><button class="icon-button" data-action="logout" title="Sign out" aria-label="Sign out">↗</button></div>
        </div>
      </aside>
      <main class="main-content">
        <header class="topbar"><div class="breadcrumb"><span>LEXORA</span><span class="crumb-separator">/</span><strong>${state.view === 'research' ? 'Legal research' : state.view === 'ai-admin' ? 'AI provider controls' : state.view === 'legal-admin' ? 'Legal source administration' : state.view === 'audit-admin' ? 'Audit log' : state.selectedCase ? escapeHtml(state.selectedCase.title) : state.view === 'cases' ? 'My matters' : 'Overview'}</strong></div><div class="topbar-right"><span class="unavailable-pill"><i></i>${state.aiStatus?.legalCorpus?.attestedVersions ? `${state.aiStatus.legalCorpus.attestedVersions} reviewed source versions` : 'No reviewed legal sources'}</span><span class="date-label">${formatDate(new Date().toISOString())}</span></div></header>
        <div class="page-content">${state.error ? `<div class="toast toast-${state.error.type}" role="alert"><span>${escapeHtml(state.error.text)}</span><button data-action="dismiss" aria-label="Dismiss">×</button></div>` : ''}${content}</div>
      </main>
    </div>`;
  app.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', (event) => {
    event.preventDefault();
    state.view = el.dataset.view;
    state.selectedCase = null;
    state.error = null;
    render();
    if (el.dataset.view === 'ai-admin') loadAiSettings();
    if (el.dataset.view === 'legal-admin') loadLegalSources();
    if (el.dataset.view === 'audit-admin') loadAuditLog();
  }));
  app.querySelectorAll('[data-case]').forEach((el) => el.addEventListener('click', () => openCase(el.dataset.case)));
  app.querySelector('[data-action="logout"]')?.addEventListener('click', logout);
  app.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => message(null));
  app.querySelector('[data-action="new-case"]')?.addEventListener('click', showNewCase);
  app.querySelector('[data-action="new-case-main"]')?.addEventListener('click', showNewCase);
  app.querySelector('[data-action="reload"]')?.addEventListener('click', loadCases);
  app.querySelectorAll('[data-action="analyze"]').forEach((button) => button.addEventListener('click', analyze));
  app.querySelectorAll('[data-action="upload"]').forEach((button) => button.addEventListener('click', () => document.getElementById('document-input')?.click()));
  app.querySelectorAll('[data-action="research"]').forEach((button) => button.addEventListener('click', research));
  app.querySelectorAll('[data-action="open-doc"]').forEach((button) => button.addEventListener('click', () => openDocument(button.dataset.doc)));
  app.querySelectorAll('[data-action="export"]').forEach((button) => button.addEventListener('click', () => exportReport(button.dataset.report)));
  app.querySelectorAll('[data-action="delete-case"]').forEach((button) => button.addEventListener('click', deleteCase));
  app.querySelectorAll('[data-action="edit-case"]').forEach((button) => button.addEventListener('click', showEditCase));
  app.querySelectorAll('[data-action="delete-document"]').forEach((button) => button.addEventListener('click', () => deleteDocument(button.dataset.doc)));
  app.querySelectorAll('[data-action="new-search"]').forEach((button) => button.addEventListener('click', () => { state.view = 'research'; state.selectedCase = null; render(); }));
}

function renderOverview() {
  const recent = state.cases.slice(0, 3);
  return `
    <section class="welcome-row">
      <div><p class="eyebrow">PRIVATE LEGAL WORKSPACE</p><h1>Good to see you.</h1><p class="muted">Organise your matters. Keep evidence and uncertainty in view.</p></div>
      <button class="button button-primary" data-action="new-case-main"><span>＋</span> New matter</button>
    </section>
    <section class="status-banner"><span class="status-icon">i</span><div><strong>Transparent by design</strong><p>${state.aiStatus?.configuredProviders?.length ? 'AI provider credentials and model IDs are configured. Provider output remains unverified.' : 'AI providers are not configured.'} ${state.aiStatus?.legalCorpus?.attestedVersions ? 'Legal research searches only administrator-attested source versions; source authenticity and legal applicability are not independently confirmed.' : 'No administrator-attested legal source material is available; no legal results or citations will be invented.'}</p></div><span class="status-badge">INFORMATION ONLY</span></section>
    <section class="stat-grid">
      <article class="stat-card"><span class="stat-label">ACTIVE MATTERS</span><strong>${state.cases.length}</strong><small>Your private workspace</small><span class="stat-symbol">▤</span></article>
      <article class="stat-card"><span class="stat-label">DOCUMENTS</span><strong>${state.cases.reduce((count, item) => count + (item.documents?.length || item.documentCount || 0), 0)}</strong><small>Plain-text files only</small><span class="stat-symbol">▧</span></article>
      <article class="stat-card"><span class="stat-label">REVIEWED SOURCES</span><strong>${state.aiStatus?.legalCorpus?.attestedVersions || 0}</strong><small>Administrator-attested versions</small><span class="stat-symbol">⌕</span></article>
    </section>
    <section class="section-heading"><div><p class="eyebrow">YOUR WORKSPACE</p><h2>Recent matters</h2></div><button class="text-button" data-view="cases">View all <span>→</span></button></section>
    ${recent.length ? `<div class="matter-table">${recent.map((item) => `
      <button class="matter-row" data-case="${item.id}"><span class="matter-icon">▤</span><span class="matter-main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.jurisdiction.replaceAll('_', ' '))} · Updated ${formatDate(item.updatedAt)}</small></span><span class="matter-count">${item.documents?.length || item.documentCount || 0} documents</span><span class="row-arrow">→</span></button>`).join('')}</div>` : emptyState('No matters yet', 'Create a matter to organise case information and plain-text documents.', 'new-case-main')}
    <section class="section-heading lower-heading"><div><p class="eyebrow">RESEARCH</p><h2>Start with a trusted source</h2></div></section>
    <div class="portal-grid">
      ${[['UAE Legislation Platform', 'Official federal and local legislation portal.', 'uaelegislation.gov.ae'], ['Ministry of Justice', 'Official UAE justice sector information.', 'moj.gov.ae'], ['DIFC Courts', 'Official DIFC court information.', 'difccourts.ae']].map(([title, detail, domain]) =>
        `<a class="portal-card" href="https://${domain}" target="_blank" rel="noopener noreferrer"><span class="portal-mark">↗</span><strong>${title}</strong><p>${detail}</p><small>${domain}</small></a>`
      ).join('')}
    </div>`;
}

function renderCases() {
  return `<section class="page-title-row"><div><p class="eyebrow">PRIVATE WORKSPACE</p><h1>My matters</h1><p class="muted">Case information is isolated to your account.</p></div><button class="button button-primary" data-action="new-case-main">＋ New matter</button></section>
    ${state.cases.length ? `<div class="case-grid">${state.cases.map((item) => `
      <article class="case-card"><button class="case-open" data-case="${item.id}"><div class="case-card-top"><span class="matter-icon">▤</span><span class="case-jurisdiction">${escapeHtml(item.jurisdiction.replaceAll('_', ' '))}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || 'No description supplied.')}</p><div class="case-card-footer"><span>${item.documents?.length || item.documentCount || 0} documents</span><span>Updated ${formatDate(item.updatedAt)}</span></div></button></article>`).join('')}</div>` : emptyState('Your workspace starts here', 'Create your first matter. You can add context and plain-text documents.', 'new-case-main')}`;
}

function emptyState(title, text, action) {
  return `<section class="empty-state"><div class="empty-illustration">L</div><h2>${title}</h2><p>${text}</p><button class="button button-secondary" data-action="${action}">＋ Create matter</button></section>`;
}

function renderResearch() {
  return `<section class="page-title-row"><div><p class="eyebrow">SOURCE-FIRST RESEARCH</p><h1>Legal research</h1><p class="muted">Search original text versions that an administrator has reviewed and attested.</p></div></section>
    <form id="research-form" class="research-form"><label class="sr-only" for="research-query">Research question</label><textarea id="research-query" name="query" rows="2" placeholder="Enter legal terms, an article number, or a phrase…" required maxlength="4000"></textarea><div class="research-controls"><label>Jurisdiction<select name="jurisdiction">${jurisdictionOptions()}</select></label><label>Relevant date (optional)<input type="date" name="relevantDate"></label><button class="button button-primary" type="submit">Keyword search <span>→</span></button><button class="button button-secondary" type="button" data-action="semantic-search">Semantic ML search</button></div><div id="research-results"></div></form>
    <div class="research-note"><span class="status-icon">i</span><div><strong>Search ranking is not legal validation</strong><p>Keyword search is literal. Semantic search uses a general multilingual embedding model to rank candidate passages; it has not been evaluated on UAE legal material and its similarity score is not a probability of legal relevance or correctness. Administrator attestation does not establish source completeness, current force, authority, or applicability. Verify the official source and consult qualified counsel.</p></div></div>
    <section class="section-heading"><div><p class="eyebrow">OFFICIAL PORTALS</p><h2>Open a source directly</h2></div></section>
    <div class="portal-grid">${[
      ['UAE Legislation Platform', 'Federal legislation and official legal material.', 'https://uaelegislation.gov.ae/en'],
      ['UAE Ministry of Justice', 'Official ministry information.', 'https://www.moj.gov.ae'],
      ['UAE Government Portal', 'Government services and information.', 'https://u.ae'],
      ['DIFC Courts', 'Official DIFC Courts resources.', 'https://www.difccourts.ae'],
      ['ADGM', 'Official Abu Dhabi Global Market resources.', 'https://www.adgm.com']
    ].map(([title, detail, link]) => `<a class="portal-card" href="${link}" target="_blank" rel="noopener noreferrer"><span class="portal-mark">↗</span><strong>${title}</strong><p>${detail}</p><small>${new URL(link).hostname}</small></a>`).join('')}</div>`;
}

function renderAiAdmin() {
  if (!state.aiConfig) {
    return `<section class="page-title-row"><div><p class="eyebrow">ADMINISTRATION</p><h1>AI provider controls</h1><p class="muted">Loading server-side configuration…</p></div></section>`;
  }
  const taskLabels = {
    document_analysis: 'Document analysis',
    issue_spotting: 'Issue spotting',
    argument_analysis: 'Argument analysis',
    case_summarization: 'Case summarisation',
    report_generation: 'Report generation',
    information_extraction: 'Information extraction',
    classification: 'Classification',
    summarization: 'Summarisation'
  };
  const routeOption = (route) => route.length === 0 ? 'disabled' : route.join(',');
  const providerCard = (name, title) => {
    const config = state.aiConfig.providers[name];
    return `<article class="provider-card"><div class="provider-title"><div><span class="provider-icon">G</span><div><h3>${title}</h3><small>${config.apiKeyConfigured ? 'Server API key configured' : 'Server API key not configured'}</small></div></div><span class="provider-state ${config.apiKeyConfigured ? 'configured' : ''}">${config.apiKeyConfigured ? 'KEY READY' : 'NOT CONFIGURED'}</span></div><label>${title} model identifier<input name="${name}Model" value="${escapeHtml(config.model || '')}" maxlength="120" pattern="[A-Za-z0-9][A-Za-z0-9._/-]*" placeholder="Set model ID in environment or here"></label><p class="provider-help">API key is server-only and is never displayed or accepted in this form. Model setting source: ${escapeHtml(config.modelSource)}.</p>${state.aiTest?.[name] ? `<p class="connection-result ${state.aiTest[name].status === 'available' ? 'available' : ''}">${escapeHtml(state.aiTest[name].message)}</p>` : ''}</article>`;
  };
  const routes = Object.entries(taskLabels).map(([task, label]) => {
    const value = routeOption(state.aiConfig.taskRoutes[task] || []);
    return `<label class="route-row"><span><strong>${label}</strong><small>Gemini is the only generative provider.</small></span><select name="route-${task}"><option value="disabled" ${value === 'disabled' ? 'selected' : ''}>Disabled</option><option value="gemini" ${value === 'gemini' ? 'selected' : ''}>Gemini</option></select></label>`;
  }).join('');
  const usageRows = state.aiUsage.map((item) => `<tr><td>${escapeHtml(item.provider)}</td><td>${escapeHtml(item.model)}</td><td>${escapeHtml(item.task)}</td><td>${item.requests}</td><td>${item.inputTokens ?? '—'}</td><td>${item.outputTokens ?? '—'}</td><td>${item.estimatedCostUsd === null ? 'Not priced' : `$${Number(item.estimatedCostUsd).toFixed(6)}`}</td></tr>`).join('');
  return `<section class="page-title-row"><div><p class="eyebrow">ADMINISTRATION · SERVER-SIDE ONLY</p><h1>AI provider controls</h1><p class="muted">Configure the Gemini model and task policies. Specialized local ML retrieval is managed by the backend model registry.</p></div><button class="button button-secondary" data-action="ai-test">Test Gemini connection</button></section>
    <div class="status-banner ai-admin-warning"><span class="status-icon">i</span><div><strong>Provider configuration only</strong><p>Keys must be provisioned as server environment secrets. This screen never returns complete keys. Each request sends selected source text to its configured provider; obtain appropriate authorization before analysis.</p></div></div>
    <form class="ai-settings-form" data-action="ai-save"><div class="provider-grid">${providerCard('gemini', 'Google Gemini')}</div><section class="content-panel route-panel"><div class="panel-heading"><div><p class="eyebrow">TASK ROUTER</p><h2>Gemini policy by task</h2></div></div><div class="route-list">${routes}</div></section><div class="form-actions"><button class="button button-primary" type="submit">Save Gemini settings</button></div></form>
    <section class="content-panel usage-panel"><div class="panel-heading"><div><p class="eyebrow">METERING</p><h2>Model usage and cost estimates</h2></div></div>${usageRows ? `<div class="table-scroll"><table><thead><tr><th>Provider</th><th>Model</th><th>Task</th><th>Requests</th><th>Input</th><th>Output</th><th>Est. cost</th></tr></thead><tbody>${usageRows}</tbody></table></div>` : '<p class="usage-empty">No provider-assisted usage has been recorded.</p>'}<p class="provider-help">Token counts come from provider responses. Cost is shown only when valid per-million-token rates are configured on the server.</p></section>`;
}

function renderAuditLog() {
  const rows = state.auditLog?.items || [];
  const events = rows.map((item) => `<article class="audit-event"><div class="audit-event-main"><strong>${escapeHtml(item.action)}</strong><small>${formatTimestamp(item.occurredAt)} · actor ${escapeHtml(item.actorId || 'system')} · resource ${escapeHtml(item.resourceId || '—')}</small><code>${escapeHtml(JSON.stringify(item.details))}</code><small>Event hash ${escapeHtml(item.eventHash)}</small></div></article>`).join('');
  return `<section class="page-title-row"><div><p class="eyebrow">ADMINISTRATION · INTEGRITY CHECK</p><h1>Audit log</h1><p class="muted">Recent local audit events, verified against the current hash chain.</p></div><button class="button button-secondary" data-action="audit-refresh">Refresh audit log</button></section>
    ${state.auditLog ? `<div class="audit-integrity-banner ${state.auditLog.integrity === 'valid' ? 'audit-integrity-valid' : ''}"><strong>Chain integrity: ${escapeHtml(state.auditLog.integrity.toUpperCase())}</strong><span>Showing up to ${rows.length} most recent events. The read event for this page is recorded after the returned snapshot.</span></div>` : '<div class="content-panel panel-empty"><strong>Loading audit events…</strong></div>'}
    <section class="content-panel audit-list-panel">${events || '<div class="panel-empty"><strong>No audit events yet</strong></div>'}</section>
    <p class="provider-help">This chain is stored in the local SQLite database. It is not protected against an operator who can alter the database and recompute its hashes; production requires external, access-controlled audit storage.</p>`;
}

function legalJurisdictionOptions(selected = 'UAE_FEDERAL') {
  return jurisdictions.filter(([value]) => value !== 'UNKNOWN').map(([value, label]) =>
    `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

function legalVersionFields() {
  return `<div class="form-grid"><label>Version label<input name="versionLabel" maxlength="100" required placeholder="e.g. Consolidated through 2025"></label><label>Version status<select name="amendmentStatus"><option value="original">Original</option><option value="amended">Amended</option><option value="consolidated">Consolidated</option><option value="superseded">Superseded</option><option value="unknown" selected>Unknown</option></select></label><label>Publication date<input type="date" name="publicationDate"></label><label>Effective date<input type="date" name="effectiveDate"></label><label>Expiry / repeal date (if confirmed)<input type="date" name="expiryDate"></label></div><label>Exact source text<textarea name="text" rows="12" maxlength="250000" required placeholder="Paste the official original text. Preserve article headings and wording."></textarea><span class="field-help">Up to 250,000 characters. Text is stored immutably with a SHA-256 hash; versions are never overwritten.</span></label>`;
}

function renderLegalAdmin() {
  const documentTypes = [
    ['legislation', 'Legislation'], ['judicial_decision', 'Judicial decision'],
    ['regulatory_decision', 'Regulatory decision'], ['official_guidance', 'Official guidance'],
    ['secondary_commentary', 'Secondary commentary']
  ];
  const sourceCards = state.legalSources.map((source) => `<article class="legal-source-admin-card">
    <div class="legal-source-admin-heading"><div><p class="eyebrow">${escapeHtml(source.jurisdiction.replaceAll('_', ' '))} · ${escapeHtml(source.documentType.replaceAll('_', ' '))}</p><h3>${escapeHtml(source.officialTitle)}</h3><p class="muted">${escapeHtml(source.issuingAuthority)}${source.documentNumber ? ` · ${escapeHtml(source.documentNumber)}` : ''} · ${escapeHtml(source.language.toUpperCase())}</p></div><a class="text-button" href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a></div>
    ${source.versions.map((version) => `<div class="legal-version-row"><div><strong>${escapeHtml(version.versionLabel)}</strong><small>${escapeHtml(version.amendmentStatus)} · effective ${escapeHtml(version.effectiveDate || 'date not recorded')} · SHA-256 ${escapeHtml(version.sha256)}</small><span class="source-review-state ${version.verificationStatus === 'reviewer_attested' ? 'reviewed' : ''}">${version.verificationStatus === 'reviewer_attested' ? `ADMIN ATTESTED · ${formatDate(version.reviewedAt)}` : 'PENDING REVIEW'}</span>${version.reviewNote ? `<small>Review note: ${escapeHtml(version.reviewNote)}</small>` : ''}</div>${version.verificationStatus === 'pending_review' ? `<button class="button button-secondary" data-action="review-legal-source" data-source="${source.id}" data-version="${version.id}">Review this version</button>` : ''}</div>`).join('')}
    <button class="text-button add-version-button" data-action="add-legal-version" data-source="${source.id}">＋ Add a new immutable version</button>
  </article>`).join('');
  return `<section class="page-title-row"><div><p class="eyebrow">ADMINISTRATION · HUMAN SOURCE REVIEW</p><h1>Legal source library</h1><p class="muted">Add primary text from official portals. Content stays unsearchable until an administrator attests to its source, text, jurisdiction, and dates.</p></div></section>
    <div class="status-banner ai-admin-warning"><span class="status-icon">i</span><div><strong>No automatic scraping or legal validation</strong><p>LEXORA never fetches or invents legal content. Only HTTPS UAE government, DIFC Courts, and ADGM domains are accepted. Admin attestation is not an independent digital authenticity check and does not establish legal effect or current applicability.</p></div></div>
    <form id="legal-source-form" class="form-panel legal-source-form">
      <div class="panel-heading"><div><p class="eyebrow">ADD SOURCE · FIRST VERSION</p><h2>Register official material</h2></div></div>
      <div class="form-grid"><label>Official title<input name="officialTitle" maxlength="240" required></label><label>Document number (optional)<input name="documentNumber" maxlength="100"></label><label>Issuing authority<input name="issuingAuthority" maxlength="180" required></label><label>Jurisdiction<select name="jurisdiction">${legalJurisdictionOptions()}</select></label><label>Material type<select name="documentType">${documentTypes.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>Original language<select name="language"><option value="en">English</option><option value="ar">Arabic</option></select></label><label class="form-grid-wide">Official source URL<input name="sourceUrl" type="url" required maxlength="500" placeholder="https://uaelegislation.gov.ae/..."><span class="field-help">Must use an approved HTTPS official domain without query parameters.</span></label></div>
      ${legalVersionFields()}<div class="form-actions"><button class="button button-primary" type="submit">Save as pending review</button></div>
    </form>
    <section class="legal-source-list"><div class="section-heading"><div><p class="eyebrow">IMMUTABLE SOURCE VERSIONS</p><h2>Registered materials</h2></div><span class="count-pill">${state.legalSources.length}</span></div>${sourceCards || '<div class="panel-empty"><strong>No sources registered</strong><p>Legal research will remain unavailable until reviewed source text is entered here.</p></div>'}</section>`;
}

function renderCaseDetail() {
  const item = state.selectedCase;
  return `<section class="page-title-row case-detail-title"><div><button class="back-link" data-view="cases">← All matters</button><p class="eyebrow">${escapeHtml(item.jurisdiction.replaceAll('_', ' '))}</p><h1>${escapeHtml(item.title)}</h1><p class="muted">${escapeHtml(item.description || 'No description supplied.')}</p><p class="detail-meta">Relevant date: ${formatDate(item.relevantDate)} · Updated ${formatDate(item.updatedAt)}</p></div><div class="case-detail-actions"><button class="button button-secondary" data-action="edit-case">Edit details</button><button class="button button-danger-outline" data-action="delete-case">Delete matter</button></div></section>
    <div class="case-actions"><button class="button button-secondary" data-action="upload">＋ Add plain-text document</button><button class="button button-primary" data-action="analyze">Run transparent text scan <span>→</span></button><input id="document-input" type="file" accept=".txt,text/plain" hidden></div>
    <section class="detail-columns"><div class="content-panel"><div class="panel-heading"><div><p class="eyebrow">SOURCE MATERIAL</p><h2>Documents</h2></div><span class="count-pill">${item.documents.length}</span></div>${item.documents.length ? `<div class="document-list">${item.documents.map((doc) => `<div class="document-row-wrap"><button class="document-row" data-action="open-doc" data-doc="${doc.id}"><span class="file-icon">TXT</span><span><strong>${escapeHtml(doc.filename)}</strong><small>${doc.characterCount.toLocaleString()} characters · SHA-256 ${doc.sha256.slice(0, 12)}…</small></span><span>→</span></button><button class="icon-button document-delete" data-action="delete-document" data-doc="${doc.id}" title="Delete document and dependent reports" aria-label="Delete ${escapeHtml(doc.filename)}">×</button></div>`).join('')}</div>` : `<div class="panel-empty"><span>▧</span><strong>No documents added</strong><p>Only text files (.txt) are supported in this build. Do not upload confidential information.</p></div>`}</div>
      <div class="content-panel"><div class="panel-heading"><div><p class="eyebrow">ANALYSIS HISTORY</p><h2>Reports</h2></div><span class="count-pill">${item.reports.length}</span></div>${item.reports.length ? `<div class="report-list">${item.reports.map((report) => `<article class="report-row"><div class="report-icon">◷</div><div class="report-info"><strong>${escapeHtml(report.mode === 'provider_assisted' ? `AI-assisted · ${report.provider}` : 'Transparent text scan')}</strong><small>${formatDate(report.createdAt)} · ${report.observations.length} observations${report.usedFallback ? ' · fallback used' : ''}</small></div><button class="icon-button" title="Export report" data-action="export" data-report="${report.id}">↓</button></article>`).join('')}</div>` : `<div class="panel-empty"><span>⌁</span><strong>No analysis reports</strong><p>Run a deterministic scan to identify dates and keyword matches in source text.</p></div>`}</div></section>
      <section class="content-panel ai-analysis-panel"><div class="panel-heading"><div><p class="eyebrow">GEMINI + LOCAL ML</p><h2>Hybrid analysis</h2></div><span class="provider-state">OPTIONAL</span></div><div class="ai-analysis-body"><p>Semantic ML ranks reviewed source passages locally; Gemini receives the selected matter text and retrieved candidates to generate an explanation. The embedding model is not validated for UAE legal analysis. Use only material you are authorized to send to Gemini. Output is unverified and is never legal advice.</p><div class="ai-controls"><label>Task<select id="ai-task"><option value="document_analysis">Document analysis</option><option value="issue_spotting">Potential issue spotting</option><option value="argument_analysis">Balanced argument analysis</option><option value="case_summarization">Case summarisation</option><option value="report_generation">Report preparation</option><option value="information_extraction">Information extraction</option><option value="classification">Classification</option><option value="summarization">Summarisation</option></select></label><label>Question (optional)<input id="ai-question" maxlength="2000" placeholder="Focus the review on a specific question"></label></div><label class="consent-row"><input id="ai-consent" type="checkbox"><span>I am authorized to send this matter's description, documents, and retrieved legal passages to Google Gemini.</span></label><button class="button button-primary" data-action="ai-analyze">Run hybrid analysis <span>→</span></button></div></section>
      <section class="content-panel timeline-panel"><div class="panel-heading"><div><p class="eyebrow">CASE TIMELINE · TEXT SIGNALS</p><h2>Date candidates</h2></div><span class="count-pill">${item.timeline?.events.length || 0}</span></div><p class="timeline-notice">${escapeHtml(item.timeline?.notice || 'Timeline extraction is unavailable.')}</p>${item.timeline?.events.length ? `<div class="timeline-list">${item.timeline.events.map((event) => `<article class="timeline-event"><div class="timeline-date"><strong>${escapeHtml(event.dateText)}</strong><small>${event.normalizedDate ? 'ISO date format' : 'Format not normalized'}</small></div><div class="timeline-source"><p>${escapeHtml(event.excerpt)}</p><small>${escapeHtml(event.filename)}${Number.isInteger(event.startOffset) ? ` · character ${event.startOffset}` : ''} · unverified</small></div></article>`).join('')}</div>` : '<p class="timeline-empty">No date-like strings found in this matter yet.</p>'}</section>
      <div class="integrity-note"><span class="status-icon">i</span><p><strong>How this analysis works.</strong> It scans local text for dates and selected phrases. It does not interpret law, search legal sources, or use an AI model. Each match links to its original document and character offset.</p></div>`;
}

function render() {
  if (!state.user) return renderAuth();
  let content = '';
  if (state.selectedCase) content = renderCaseDetail();
  else if (state.view === 'cases') content = renderCases();
  else if (state.view === 'research') content = renderResearch();
  else if (state.view === 'legal-admin' && state.user.role === 'admin') content = renderLegalAdmin();
  else if (state.view === 'audit-admin' && state.user.role === 'admin') content = renderAuditLog();
  else if (state.view === 'ai-admin' && state.user.role === 'admin') content = renderAiAdmin();
  else content = renderOverview();
  renderShell(content);
  const fileInput = document.getElementById('document-input');
  fileInput?.addEventListener('change', uploadDocument);
  document.getElementById('research-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    research(event);
  });
  app.querySelector('[data-action="ai-save"]')?.addEventListener('submit', saveAiSettings);
  app.querySelector('[data-action="ai-test"]')?.addEventListener('click', testAiProviders);
  app.querySelector('[data-action="semantic-search"]')?.addEventListener('click', semanticResearch);
  app.querySelector('[data-action="audit-refresh"]')?.addEventListener('click', loadAuditLog);
  app.querySelector('[data-action="ai-analyze"]')?.addEventListener('click', runAiAnalysis);
  app.querySelector('#legal-source-form')?.addEventListener('submit', createLegalSource);
  app.querySelectorAll('[data-action="review-legal-source"]').forEach((button) =>
    button.addEventListener('click', () => showLegalReview(button.dataset.source, button.dataset.version))
  );
  app.querySelectorAll('[data-action="add-legal-version"]').forEach((button) =>
    button.addEventListener('click', () => showAddLegalVersion(button.dataset.source))
  );
}

async function loadCases() {
  setLoading(true);
  try {
    const [{ items }, aiStatus] = await Promise.all([
      api('/api/v1/cases'),
      api('/api/v1/ai/status')
    ]);
    state.aiStatus = aiStatus;
    state.cases = await Promise.all(items.map(async (item) => {
      const detail = await api(`/api/v1/cases/${item.id}`);
      const [documents, reports] = await Promise.all([
        api(`/api/v1/cases/${item.id}/documents`),
        api(`/api/v1/cases/${item.id}/reports`)
      ]);
      return { ...detail.item, documents: documents.items, reports: reports.items };
    }));
    state.error = null;
  } catch (error) {
    state.error = { text: error.message, type: 'error' };
  } finally {
    state.loading = false;
    render();
  }
}

async function loadAiSettings() {
  try {
    const [config, usage] = await Promise.all([
      api('/api/v1/admin/ai'),
      api('/api/v1/admin/ai/usage')
    ]);
    state.aiConfig = config;
    state.aiUsage = usage.items;
    state.error = null;
  } catch (error) {
    state.error = { text: error.message, type: 'error' };
  }
  if (state.view === 'ai-admin') render();
}

async function loadLegalSources() {
  try {
    const [sources, status] = await Promise.all([
      api('/api/v1/admin/legal-sources'),
      api('/api/v1/ai/status')
    ]);
    state.legalSources = sources.items;
    state.aiStatus = status;
    state.error = null;
  } catch (error) {
    state.error = { text: error.message, type: 'error' };
  }
  if (state.view === 'legal-admin') render();
}

async function loadAuditLog() {
  state.auditLog = null;
  if (state.view === 'audit-admin') render();
  try {
    state.auditLog = await api('/api/v1/admin/audit');
    state.error = null;
  } catch (error) {
    state.error = { text: error.message, type: 'error' };
  }
  if (state.view === 'audit-admin') render();
}

async function createLegalSource(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const { text, versionLabel, publicationDate, effectiveDate, expiryDate, amendmentStatus, ...source } = values;
  try {
    await api('/api/v1/admin/legal-sources', {
      method: 'POST',
      body: JSON.stringify({
        ...source,
        version: { text, versionLabel, publicationDate, effectiveDate, expiryDate, amendmentStatus }
      })
    });
    await loadLegalSources();
    state.error = { text: 'Source saved as pending review. It is not available in research until reviewed.', type: 'success' };
    render();
  } catch (error) {
    message(error.message);
  }
}

async function showLegalReview(sourceId, versionId) {
  try {
    const result = await api(`/api/v1/admin/legal-sources/${sourceId}/versions/${versionId}`);
    const source = state.legalSources.find((item) => item.id === sourceId);
    if (!source) return message('The legal source is no longer available.');
    const modal = document.createElement('section');
    modal.className = 'modal-backdrop';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'legal-review-heading');
    modal.innerHTML = `<div class="report-modal legal-review-modal"><button class="modal-close" aria-label="Close">×</button><p class="eyebrow">HUMAN REVIEW · IMMUTABLE VERSION</p><h2 id="legal-review-heading">${escapeHtml(source.officialTitle)} · ${escapeHtml(result.item.versionLabel)}</h2><p class="review-source-link"><a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open official source ${new URL(source.sourceUrl).hostname} ↗</a></p><p class="provider-help">Compare the displayed original text with the official publication. Check source, language, jurisdiction, title, version, publication and effective dates. This attestation is not a digital signature or independent LEXORA validation.</p><p class="preview-hash">SHA-256 ${escapeHtml(result.item.sha256)}</p><pre class="legal-original-text" dir="auto"></pre><form id="legal-review-form"><input type="hidden" name="reviewedSha256" value="${escapeHtml(result.item.sha256)}"><label class="review-checkbox"><input type="checkbox" name="checkedSourceUrl" required><span>I opened the official source URL and confirmed it is the official publication.</span></label><label class="review-checkbox"><input type="checkbox" name="checkedOriginalText" required><span>I compared the source text above with the official text and confirmed it matches.</span></label><label class="review-checkbox"><input type="checkbox" name="checkedDatesAndJurisdiction" required><span>I checked the jurisdiction, language, version and recorded dates against the official publication.</span></label><label>Review note<textarea name="reviewNote" required minlength="20" maxlength="1000" rows="3" placeholder="Record what you checked; do not make a legal applicability conclusion."></textarea></label><div class="form-actions"><button type="button" class="button button-quiet modal-cancel">Cancel</button><button type="submit" class="button button-primary">Attest source version</button></div></form></div>`;
    modal.querySelector('.legal-original-text').textContent = result.item.originalText;
    app.appendChild(modal);
    modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (click) => { if (click.target === modal) modal.remove(); });
    modal.querySelector('#legal-review-form').addEventListener('submit', async (submitEvent) => {
      submitEvent.preventDefault();
      const values = Object.fromEntries(new FormData(submitEvent.currentTarget));
      try {
        const response = await api(`/api/v1/admin/legal-sources/${sourceId}/versions/${versionId}/review`, {
          method: 'POST',
          body: JSON.stringify({
            reviewedSha256: values.reviewedSha256,
            reviewNote: values.reviewNote,
            checkedSourceUrl: values.checkedSourceUrl === 'on',
            checkedOriginalText: values.checkedOriginalText === 'on',
            checkedDatesAndJurisdiction: values.checkedDatesAndJurisdiction === 'on'
          })
        });
        modal.remove();
        await loadLegalSources();
        state.error = { text: response.notice, type: 'success' };
        render();
      } catch (error) {
        message(error.message);
      }
    });
  } catch (error) {
    message(error.message);
  }
}

async function showAddLegalVersion(sourceId) {
  const source = state.legalSources.find((item) => item.id === sourceId);
  if (!source) return message('The legal source is no longer available.');
  const modal = document.createElement('section');
  modal.className = 'modal-backdrop';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', `Add version to ${source.officialTitle}`);
  modal.innerHTML = `<div class="report-modal legal-review-modal"><button class="modal-close" aria-label="Close">×</button><p class="eyebrow">IMMUTABLE VERSION</p><h2>Add version · ${escapeHtml(source.officialTitle)}</h2><p class="provider-help">This creates a separate source version and never overwrites existing text.</p><form id="legal-version-form">${legalVersionFields()}<div class="form-actions"><button type="button" class="button button-quiet modal-cancel">Cancel</button><button type="submit" class="button button-primary">Save as pending review</button></div></form></div>`;
  app.appendChild(modal);
  modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
  modal.querySelector('.modal-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (click) => { if (click.target === modal) modal.remove(); });
  modal.querySelector('#legal-version-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/api/v1/admin/legal-sources/${sourceId}/versions`, { method: 'POST', body: JSON.stringify(values) });
      modal.remove();
      await loadLegalSources();
      state.error = { text: 'New immutable version saved as pending review.', type: 'success' };
      render();
    } catch (error) {
      message(error.message);
    }
  });
}

async function saveAiSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const providers = {};
  for (const provider of ['gemini']) {
    const model = values[`${provider}Model`].trim();
    if (model) providers[provider] = { model };
  }
  const taskRoutes = {};
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith('route-')) continue;
    taskRoutes[key.slice(6)] = value === 'disabled' ? [] : value.split(',');
  }
  try {
    state.aiConfig = await api('/api/v1/admin/ai', {
      method: 'PUT',
      body: JSON.stringify({ providers, taskRoutes })
    });
    const usage = await api('/api/v1/admin/ai/usage');
    state.aiUsage = usage.items;
    state.aiTest = null;
    state.error = { text: 'Provider routing settings saved. API keys remain server-side.', type: 'success' };
    render();
  } catch (error) {
    message(error.message);
  }
}

async function testAiProviders() {
  try {
    const result = await api('/api/v1/admin/ai/test', { method: 'POST', body: '{}' });
    state.aiTest = result.results;
    render();
  } catch (error) {
    message(error.message);
  }
}

async function openCase(id) {
  state.error = null;
  try {
    const [detail, documents, reports, timeline] = await Promise.all([
      api(`/api/v1/cases/${id}`),
      api(`/api/v1/cases/${id}/documents`),
      api(`/api/v1/cases/${id}/reports`),
      api(`/api/v1/cases/${id}/timeline`)
    ]);
    state.selectedCase = { ...detail.item, documents: documents.items, reports: reports.items, timeline };
    state.view = 'cases';
    render();
  } catch (error) {
    message(error.message);
  }
}

function showNewCase() {
  const content = `<section class="page-title-row"><div><p class="eyebrow">PRIVATE WORKSPACE</p><h1>Create a matter</h1><p class="muted">Jurisdiction and relevant dates are user-supplied, not inferred.</p></div></section>
    <form id="case-form" class="form-panel"><label>Matter name<input name="title" maxlength="160" required placeholder="e.g. Supplier agreement review"></label><label>Context<textarea name="description" maxlength="5000" rows="4" placeholder="Record the facts you want to organise. Avoid unnecessary personal data."></textarea></label><div class="form-grid"><label>Jurisdiction<select name="jurisdiction">${jurisdictionOptions()}</select><span class="field-help">Select “Not specified” if you are uncertain.</span></label><label>Relevant date<input type="date" name="relevantDate"><span class="field-help">Optional. No historical legal analysis is performed.</span></label></div><div class="form-actions"><button type="button" class="button button-quiet" data-action="cancel">Cancel</button><button class="button button-primary" type="submit">Create matter <span>→</span></button></div></form>`;
  state.view = 'cases';
  state.selectedCase = null;
  renderShell(content);
  document.querySelector('[data-action="cancel"]').addEventListener('click', () => { state.view = 'cases'; render(); });
  document.getElementById('case-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const { item } = await api('/api/v1/cases', { method: 'POST', body: JSON.stringify(body) });
      await loadCases();
      await openCase(item.id);
    } catch (error) {
      message(error.message);
    }
  });
}

function showEditCase() {
  const item = state.selectedCase;
  if (!item) return;
  const content = `<section class="page-title-row"><div><p class="eyebrow">PRIVATE WORKSPACE</p><h1>Edit matter</h1><p class="muted">Update your supplied matter details. Changes are audit logged.</p></div></section>
    <form id="case-form" class="form-panel"><label>Matter name<input name="title" maxlength="160" required value="${escapeHtml(item.title)}"></label><label>Context<textarea name="description" maxlength="5000" rows="4">${escapeHtml(item.description || '')}</textarea></label><div class="form-grid"><label>Jurisdiction<select name="jurisdiction">${jurisdictionOptions(item.jurisdiction)}</select><span class="field-help">Select “Not specified” if you are uncertain.</span></label><label>Relevant date<input type="date" name="relevantDate" value="${escapeHtml(item.relevantDate || '')}"><span class="field-help">Optional. No historical legal analysis is performed.</span></label></div><div class="form-actions"><button type="button" class="button button-quiet" data-action="cancel">Cancel</button><button class="button button-primary" type="submit">Save changes <span>→</span></button></div></form>`;
  state.view = 'cases';
  renderShell(content);
  document.querySelector('[data-action="cancel"]').addEventListener('click', () => openCase(item.id));
  document.getElementById('case-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/api/v1/cases/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await loadCases();
      await openCase(item.id);
      state.error = { text: 'Matter details updated.', type: 'success' };
      render();
    } catch (error) {
      message(error.message);
    }
  });
}

async function uploadDocument(event) {
  const file = event.target.files?.[0];
  if (!file || !state.selectedCase) return;
  if (!file.name.toLowerCase().endsWith('.txt') || file.size > 200_000) {
    message('Choose a .txt file no larger than 200 KB.');
    return;
  }
  try {
    const content = await file.text();
    await api(`/api/v1/cases/${state.selectedCase.id}/documents`, {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, mediaType: 'text/plain', content })
    });
    state.error = { text: 'Document added and SHA-256 recorded. No AI processing was performed.', type: 'success' };
    await loadCases();
    await openCase(state.selectedCase.id);
  } catch (error) {
    message(error.message);
  } finally {
    event.target.value = '';
  }
}

async function openDocument(id) {
  try {
    const { item } = await api(`/api/v1/cases/${state.selectedCase.id}/documents/${id}`);
    const preview = document.createElement('section');
    preview.className = 'modal-backdrop';
    preview.setAttribute('role', 'dialog');
    preview.setAttribute('aria-modal', 'true');
    preview.setAttribute('aria-label', `Document preview: ${item.filename}`);
    preview.innerHTML = '<div class="report-modal document-modal"><button class="modal-close" aria-label="Close">×</button><p class="eyebrow">LOCAL SOURCE TEXT · ORIGINAL CONTENT</p><h2 class="preview-title"></h2><p class="preview-hash"></p><pre class="document-preview"></pre></div>';
    preview.querySelector('.preview-title').textContent = item.filename;
    preview.querySelector('.preview-hash').textContent = `SHA-256 ${item.sha256}`;
    preview.querySelector('.document-preview').textContent = item.content;
    app.appendChild(preview);
    preview.querySelector('.modal-close').addEventListener('click', () => preview.remove());
    preview.addEventListener('click', (event) => { if (event.target === preview) preview.remove(); });
  } catch (error) {
    message(error.message);
  }
}

async function analyze() {
  if (!state.selectedCase) return;
  const button = document.querySelector('[data-action="analyze"]');
  if (button) button.disabled = true;
  try {
    const { report } = await api(`/api/v1/cases/${state.selectedCase.id}/analyze`, { method: 'POST', body: '{}' });
    await loadCases();
    await openCase(state.selectedCase.id);
    showReport(report);
  } catch (error) {
    message(error.message);
  }
}

async function runAiAnalysis() {
  if (!state.selectedCase) return;
  const consent = document.getElementById('ai-consent');
  if (!consent?.checked) return message('Confirm that you are authorized to send these materials to the configured provider.');
  const caseId = state.selectedCase.id;
  const task = document.getElementById('ai-task')?.value;
  const question = document.getElementById('ai-question')?.value || '';
  const button = document.querySelector('[data-action="ai-analyze"]');
  if (button) button.disabled = true;
  try {
    const { report } = await api(`/api/v1/cases/${caseId}/ai-analysis`, {
      method: 'POST',
      body: JSON.stringify({ task, question })
    });
    await loadCases();
    await openCase(caseId);
    showReport(report);
  } catch (error) {
    message(error.message);
  }
}

function showReport(report) {
  const view = document.createElement('section');
  view.className = 'modal-backdrop';
  view.setAttribute('role', 'dialog');
  view.setAttribute('aria-modal', 'true');
  view.setAttribute('aria-labelledby', 'report-heading');
  const aiReport = report.mode === 'provider_assisted';
  const observations = report.observations || [];
  const dates = report.candidateDates || [];
  view.innerHTML = `<div class="report-modal"><button class="modal-close" aria-label="Close">×</button><p class="eyebrow">${aiReport ? `AI-ASSISTED · ${escapeHtml(report.provider)} · ${escapeHtml(report.model)}` : 'DETERMINISTIC TEXT SCAN'} · ${formatDate(report.createdAt)}</p><h2 id="report-heading">Review report</h2><p class="muted">${escapeHtml(report.summary || report.scope)}</p><div class="report-callout"><strong>Not legal advice.</strong> No authoritative legal-source verification is performed. Observations are unverified.${aiReport ? ` Tokens: ${report.usage.inputTokens ?? 'unknown'} in / ${report.usage.outputTokens ?? 'unknown'} out.` : ' No AI model was used.'}</div>
    ${report.sections?.length ? `<div class="report-section ai-report-sections">${report.sections.map((section) => `<article class="ai-report-section"><h3>${escapeHtml(section.heading)}</h3><p>${escapeHtml(section.content)}</p></article>`).join('')}</div>` : ''}
    ${report.mlEvidence ? `<div class="report-section"><h3>Local semantic retrieval <span>${report.mlEvidence.results?.length || 0}</span></h3><p class="muted">Model ${escapeHtml(report.mlEvidence.model)} · ${escapeHtml(report.mlEvidence.status)}. Cosine similarity ranks text only; it is not confidence in legal relevance or correctness.</p>${report.mlEvidence.results?.length ? report.mlEvidence.results.map((item) => `<article class="finding"><div><strong>${escapeHtml(item.officialTitle)} · Article ${escapeHtml(item.articleNumber)}</strong><span class="finding-tag">COSINE ${escapeHtml(item.cosineSimilarity)}</span></div><p>${escapeHtml(item.excerpt)}</p><small>${escapeHtml(item.jurisdiction)} · ${escapeHtml(item.versionLabel)} · effective ${escapeHtml(item.effectiveDate || 'date not recorded')} · <a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">open source</a></small></article>`).join('') : '<p class="muted">No reviewed passages were retrieved for this jurisdiction/date, or the local model was unavailable.</p>'}</div>` : ''}
    <div class="report-section"><h3>${aiReport ? 'Evidence-linked observations' : 'Phrase matches'} <span>${observations.length}</span></h3>${observations.length ? observations.map((observation) => `<article class="finding"><div><strong>${escapeHtml(observation.phrase || observation.observation)}</strong><span class="finding-tag">${aiReport ? 'UNVERIFIED AI · QUOTE MATCHED' : 'UNVERIFIED TEXT MATCH'}</span></div><p>${escapeHtml(observation.excerpt || observation.exactQuote)}</p><small>${escapeHtml(observation.filename || observation.documentId)}${Number.isInteger(observation.startOffset) ? ` · character ${observation.startOffset}` : ''}${observation.uncertainty ? ` · ${escapeHtml(observation.uncertainty)}` : ''}</small></article>`).join('') : `<p class="muted">${aiReport ? 'The provider returned no evidence-linked observations.' : 'No configured phrase matches found in the supplied text.'}</p>`}</div>
    ${dates.length ? `<div class="report-section"><h3>Candidate dates <span>${dates.length}</span></h3>${dates.map((date) => `<p class="candidate-date"><strong>${escapeHtml(date.value)}</strong> in ${escapeHtml(date.filename)} <small> · unverified</small></p>`).join('')}</div>` : ''}
    <div class="report-section"><h3>Uncertainties</h3><ul>${report.uncertainties.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div><button class="button button-secondary modal-export" data-action="export" data-report="${report.id}">↓ Export JSON report</button></div>`;
  app.appendChild(view);
  view.querySelector('.modal-close').addEventListener('click', () => view.remove());
  view.addEventListener('click', (event) => { if (event.target === view) view.remove(); });
  view.querySelector('[data-action="export"]').addEventListener('click', () => exportReport(report.id));
}

function exportReport(id) {
  const report = state.selectedCase?.reports.find((item) => item.id === id);
  if (!report) return message('The report is not available in this matter.');
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `lexora-report-${report.id}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function research(event) {
  const form = document.getElementById('research-form');
  if (!form) return;
  if (event?.preventDefault) event.preventDefault();
  const fields = Object.fromEntries(new FormData(form));
  const target = document.getElementById('research-results');
  if (target) target.innerHTML = '<p class="loading-note">Checking local source registry…</p>';
  try {
    const result = await api('/api/v1/research/search', { method: 'POST', body: JSON.stringify(fields) });
    const links = result.portals.map((portal) => `<a href="${portal.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(portal.title)} <span>↗</span></a>`).join('');
    if (!target) return;
    if (!result.results.length) {
      const heading = result.status === 'jurisdiction_required' ? 'Select a jurisdiction' :
        result.status === 'corpus_pending_review' ? 'Source review pending' :
          result.status === 'no_matching_sources' ? 'No keyword matches' : 'No reviewed legal material';
      target.innerHTML = `<div class="research-unavailable"><strong>${heading}</strong><p>${escapeHtml(result.notice)}</p><div>${links}</div></div>`;
      return;
    }
    target.innerHTML = `<div class="research-result-summary"><strong>${result.results.length} source matches</strong><p>${escapeHtml(result.notice)}</p></div><div class="research-result-list">${result.results.map((item, index) => `
      <article class="research-result">
        <div class="research-result-heading"><div><p class="eyebrow">${escapeHtml(item.jurisdiction.replaceAll('_', ' '))} · ${escapeHtml(item.documentType.replaceAll('_', ' '))}</p><h3>${escapeHtml(item.officialTitle)}${item.documentNumber ? ` · ${escapeHtml(item.documentNumber)}` : ''}</h3></div><span class="source-review-state reviewed">ADMIN ATTESTED</span></div>
        <p class="research-result-meta">${escapeHtml(item.issuingAuthority)} · ${escapeHtml(item.articleNumber === 'FULL_TEXT' ? 'Full text' : `Article ${item.articleNumber}`)}${item.articleTitle ? ` · ${escapeHtml(item.articleTitle)}` : ''} · version ${escapeHtml(item.versionLabel)} · effective ${escapeHtml(item.effectiveDate || 'date not recorded')}</p>
        <pre class="research-excerpt" dir="auto">${escapeHtml(item.excerpt)}</pre>
        <div class="research-result-footer"><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open original source ↗</a><button type="button" class="button button-secondary" data-action="verify-citation" data-source="${item.legalSourceId}" data-version="${item.versionId}" data-article="${escapeHtml(item.articleNumber)}" data-jurisdiction="${escapeHtml(item.jurisdiction)}" data-date="${escapeHtml(fields.relevantDate || '')}">Check a quoted passage</button></div>
      </article>`).join('')}</div>`;
    target.querySelectorAll('[data-action="verify-citation"]').forEach((button) =>
      button.addEventListener('click', () => verifyResearchCitation(button))
    );
  } catch (error) {
    if (target) target.innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
  }
}

async function semanticResearch() {
  const form = document.getElementById('research-form');
  if (!form) return;
  const fields = Object.fromEntries(new FormData(form));
  const target = document.getElementById('research-results');
  if (target) target.innerHTML = '<p class="loading-note">Loading the local multilingual ML model and ranking reviewed passages…</p>';
  try {
    const result = await api('/api/v1/research/semantic-search', { method: 'POST', body: JSON.stringify(fields) });
    if (!target) return;
    if (!result.results.length) {
      target.innerHTML = `<div class="research-unavailable"><strong>${result.status === 'no_reviewed_sources' ? 'No reviewed legal material' : 'No semantic matches'}</strong><p>${escapeHtml(result.notice)}</p></div>`;
      return;
    }
    target.innerHTML = `<div class="research-result-summary"><strong>${result.results.length} semantic candidate passages</strong><p>${escapeHtml(result.notice)} ${result.searchScopeComplete ? 'The indexed scope was evaluated.' : 'The search scope was bounded; relevant passages may be omitted.'}</p></div><div class="research-result-list">${result.results.map((item) => `
      <article class="research-result">
        <div class="research-result-heading"><div><p class="eyebrow">${escapeHtml(item.jurisdiction.replaceAll('_', ' '))} · ${escapeHtml(item.documentType.replaceAll('_', ' '))}</p><h3>${escapeHtml(item.officialTitle)} · Article ${escapeHtml(item.articleNumber)}</h3></div><span class="source-review-state reviewed">ADMIN ATTESTED</span></div>
        <p class="research-result-meta">${escapeHtml(item.issuingAuthority)} · version ${escapeHtml(item.versionLabel)} · effective ${escapeHtml(item.effectiveDate || 'date not recorded')} · cosine similarity ${escapeHtml(item.cosineSimilarity)}</p>
        <pre class="research-excerpt" dir="auto">${escapeHtml(item.excerpt)}</pre>
        <div class="research-result-footer"><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open original source ↗</a></div>
      </article>`).join('')}</div>`;
  } catch (error) {
    if (target) target.innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
  }
}

async function verifyResearchCitation(button) {
  const quotedText = window.prompt('Paste the exact passage you want checked (up to 2,000 characters). The check is literal text matching, not legal analysis.');
  if (!quotedText) return;
  const target = document.getElementById('research-results');
  try {
    const result = await api('/api/v1/citations/verify', {
      method: 'POST',
      body: JSON.stringify({
        legalSourceId: button.dataset.source,
        versionId: button.dataset.version,
        articleNumber: button.dataset.article,
        jurisdiction: button.dataset.jurisdiction,
        relevantDate: button.dataset.date || null,
        quotedText
      })
    });
    const notice = document.createElement('div');
    notice.className = `citation-check citation-check-${result.status}`;
    notice.innerHTML = `<strong>${escapeHtml(result.status.replaceAll('_', ' ').toUpperCase())} · ${result.quoteMatch ? 'QUOTE MATCH' : 'NO QUOTE MATCH'}</strong><p>${escapeHtml(result.reason)}</p><small>${escapeHtml(result.citation.officialTitle)} · ${escapeHtml(result.citation.articleNumber)} · version ${escapeHtml(result.citation.versionLabel)} · SHA-256 ${escapeHtml(result.citation.sha256)}</small><p>${escapeHtml(result.notice)}</p>`;
    target.appendChild(notice);
    notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    message(error.message);
  }
}

async function deleteCase() {
  if (!state.selectedCase || !window.confirm(`Permanently delete "${state.selectedCase.title}" and its stored documents and reports?`)) return;
  try {
    await api(`/api/v1/cases/${state.selectedCase.id}`, { method: 'DELETE', body: '{}' });
    state.selectedCase = null;
    state.error = { text: 'Matter and its documents were deleted.', type: 'success' };
    await loadCases();
  } catch (error) {
    message(error.message);
  }
}

async function deleteDocument(documentId) {
  const documentItem = state.selectedCase?.documents.find((item) => item.id === documentId);
  if (!state.selectedCase || !documentItem) return;
  if (!window.confirm(`Permanently delete "${documentItem.filename}" and analysis reports that used it?`)) return;
  const caseId = state.selectedCase.id;
  try {
    const result = await api(`/api/v1/cases/${caseId}/documents/${documentId}`, { method: 'DELETE', body: '{}' });
    await loadCases();
    await openCase(caseId);
    state.error = {
      text: `Document deleted. ${result.reportsDeleted} dependent report${result.reportsDeleted === 1 ? '' : 's'} also removed.`,
      type: 'success'
    };
    render();
  } catch (error) {
    message(error.message);
  }
}

async function logout() {
  try {
    await api('/api/v1/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    // Clear the local view even if the server is unreachable; the server session still expires.
  }
  state.user = null;
  state.csrf = null;
  state.cases = [];
  state.selectedCase = null;
  state.error = null;
  render();
}

async function init() {
  try {
    const result = await api('/api/v1/auth/me');
    state.user = result.user;
    state.csrf = result.csrfToken;
    await loadCases();
  } catch {
    renderAuth();
  }
}

renderAuth();
init();
