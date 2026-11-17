'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');

async function setup(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexora-test-'));
  const app = createServer({ dbPath: path.join(dir, 'test.sqlite'), ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  let cookie = '';
  let csrf = '';

  async function request(route, { method = 'GET', body, authenticated = true, token = csrf } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (authenticated && cookie) headers.cookie = cookie;
    if (authenticated && method !== 'GET') headers['x-csrf-token'] = token;
    const response = await fetch(`${base}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : await response.text();
    if (response.headers.get('set-cookie')) {
      cookie = response.headers.get('set-cookie').split(';')[0];
    }
    if (result?.csrfToken) csrf = result.csrfToken;
    return { response, result };
  }

  async function register(email, password = 'correct-horse-battery') {
    return request('/api/v1/auth/register', {
      method: 'POST',
      authenticated: false,
      body: { email, password }
    });
  }

  return {
    app, request, register,
    cleanup: async () => {
      await new Promise((resolve) => app.server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('health and public shell report real service availability without false AI claims', async (t) => {
  const ctx = await setup();
  t.after(ctx.cleanup);
  const health = await ctx.request('/api/v1/health', { authenticated: false });
  assert.equal(health.result.status, 'ok');
  assert.equal(health.result.ai.status, 'not_configured');
  assert.equal(health.result.legalCorpus.status, 'not_configured');
  const shell = await ctx.request('/');
  assert.equal(shell.response.status, 200);
  assert.match(shell.response.headers.get('content-security-policy'), /default-src 'self'/);
  const icon = await ctx.request('/favicon.svg');
  assert.equal(icon.response.status, 200);
  assert.match(icon.response.headers.get('content-type'), /image\/svg\+xml/);
  const config = await ctx.request('/api-config.js');
  assert.equal(config.response.status, 200);
  assert.match(config.result, /LEXORA_API_BASE_URL/);
});

test('GitHub Pages API CORS is restricted to the configured HTTPS origin', async (t) => {
  const origin = 'https://kevinantonakhil-coder.github.io';
  const ctx = await setup({ env: { LEXORA_ALLOWED_ORIGIN: origin } });
  t.after(ctx.cleanup);
  const address = ctx.app.server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const preflight = await fetch(`${base}/api/v1/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-csrf-token'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-CSRF-Token/i);

  const registration = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pages@example.test', password: 'correct-horse-battery' })
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.headers.get('access-control-allow-origin'), origin);
  assert.match(registration.headers.get('set-cookie'), /SameSite=None; Max-Age=/);
  assert.match(registration.headers.get('set-cookie'), /Secure/);

  const rejected = await fetch(`${base}/api/v1/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.example',
      'Access-Control-Request-Method': 'POST'
    }
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
});

test('registration validates password and starts a user with a CSRF-protected session', async (t) => {
  const ctx = await setup();
  t.after(ctx.cleanup);
  const weak = await ctx.register('first@example.test', 'short');
  assert.equal(weak.response.status, 400);
  const created = await ctx.register('first@example.test');
  assert.equal(created.response.status, 201);
  assert.equal(created.result.user.role, 'user');
  const me = await ctx.request('/api/v1/auth/me');
  assert.equal(me.result.user.email, 'first@example.test');
  assert.equal(me.result.csrfToken, created.result.csrfToken);
});

test('CSRF token is required for case writes and case input is validated', async (t) => {
  const ctx = await setup();
  t.after(ctx.cleanup);
  await ctx.register('writer@example.test');
  const missingCsrf = await ctx.request('/api/v1/cases', { method: 'POST', body: { title: 'Example' }, token: '' });
  assert.equal(missingCsrf.response.status, 403);
  const invalidDate = await ctx.request('/api/v1/cases', {
    method: 'POST',
    body: { title: 'Example', relevantDate: '2025-02-31' }
  });
  assert.equal(invalidDate.response.status, 400);
  const created = await ctx.request('/api/v1/cases', {
    method: 'POST',
    body: { title: 'Example', jurisdiction: 'UNKNOWN' }
  });
  assert.equal(created.response.status, 201);
  const updated = await ctx.request(`/api/v1/cases/${created.result.item.id}`, {
    method: 'PATCH',
    body: { title: 'Updated example', description: 'Updated by owner', jurisdiction: 'DIFC' }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.result.item.title, 'Updated example');
  assert.equal(updated.result.item.description, 'Updated by owner');
  assert.equal(updated.result.item.jurisdiction, 'DIFC');
});

test('accounts cannot read, modify, or analyze another account case', async (t) => {
  const ctx = await setup();
  t.after(ctx.cleanup);
  await ctx.register('owner@example.test');
  const created = await ctx.request('/api/v1/cases', { method: 'POST', body: { title: 'Private matter' } });
  const caseId = created.result.item.id;
  await ctx.request('/api/v1/auth/logout', { method: 'POST', body: {} });
  const second = await ctx.register('other@example.test');
  assert.equal(second.response.status, 201);
  const read = await ctx.request(`/api/v1/cases/${caseId}`);
  assert.equal(read.response.status, 404);
  const update = await ctx.request(`/api/v1/cases/${caseId}`, { method: 'PATCH', body: { title: 'stolen' } });
  assert.equal(update.response.status, 404);
  const analysis = await ctx.request(`/api/v1/cases/${caseId}/analyze`, { method: 'POST', body: {} });
  assert.equal(analysis.response.status, 404);
  const timeline = await ctx.request(`/api/v1/cases/${caseId}/timeline`);
  assert.equal(timeline.response.status, 404);
});

test('document upload only accepts plain text and scans preserve exact source references without legal claims', async (t) => {
  const ctx = await setup();
  t.after(ctx.cleanup);
  await ctx.register('analyst@example.test');
  const created = await ctx.request('/api/v1/cases', { method: 'POST', body: { title: 'Agreement review' } });
  const caseId = created.result.item.id;
  const rejected = await ctx.request(`/api/v1/cases/${caseId}/documents`, {
    method: 'POST',
    body: { filename: 'contract.pdf', mediaType: 'application/pdf', content: 'not really a PDF' }
  });
  assert.equal(rejected.response.status, 415);
  const text = 'Notice begins on 2025-02-14. Termination and payment are mentioned.';
  const uploaded = await ctx.request(`/api/v1/cases/${caseId}/documents`, {
    method: 'POST',
    body: { filename: 'contract.txt', mediaType: 'text/plain', content: text }
  });
  assert.equal(uploaded.response.status, 201);
  assert.equal(uploaded.result.item.sha256.length, 64);
  const analysis = await ctx.request(`/api/v1/cases/${caseId}/analyze`, { method: 'POST', body: {} });
  assert.equal(analysis.response.status, 201);
  assert.equal(analysis.result.report.scope, 'Deterministic text scan only. No AI model or legal database was used.');
  assert.equal(analysis.result.report.observations.length, 3);
  assert.equal(analysis.result.report.observations[0].documentId, uploaded.result.item.id);
  assert.equal(analysis.result.report.candidateDates[0].value, '2025-02-14');
  assert.deepEqual(analysis.result.report.legalSources, []);
  const timeline = await ctx.request(`/api/v1/cases/${caseId}/timeline`);
  assert.equal(timeline.result.status, 'candidate_dates_only');
  assert.equal(timeline.result.events[0].dateText, '2025-02-14');
  assert.equal(timeline.result.events[0].documentId, uploaded.result.item.id);
  assert.equal(timeline.result.events[0].startOffset, text.indexOf('2025-02-14'));
});

test('document deletion enforces case ownership and removes dependent reports', async (t) => {
  const ctx = await setup();
  t.after(ctx.cleanup);
  await ctx.register('document-owner@example.test');
  const created = await ctx.request('/api/v1/cases', { method: 'POST', body: { title: 'Document deletion test' } });
  const caseId = created.result.item.id;
  const uploaded = await ctx.request(`/api/v1/cases/${caseId}/documents`, {
    method: 'POST',
    body: { filename: 'source.txt', mediaType: 'text/plain', content: 'Termination notice on 2025-01-15.' }
  });
  const documentId = uploaded.result.item.id;
  const report = await ctx.request(`/api/v1/cases/${caseId}/analyze`, { method: 'POST', body: {} });
  assert.equal(report.response.status, 201);
  assert.equal((await ctx.request(`/api/v1/cases/${caseId}/reports`)).result.items.length, 1);
  const noCsrf = await ctx.request(`/api/v1/cases/${caseId}/documents/${documentId}`, {
    method: 'DELETE', body: {}, token: ''
  });
  assert.equal(noCsrf.response.status, 403);
  await ctx.request('/api/v1/auth/logout', { method: 'POST', body: {} });
  await ctx.register('other-owner@example.test');
  const forbidden = await ctx.request(`/api/v1/cases/${caseId}/documents/${documentId}`, {
    method: 'DELETE', body: {}
  });
  assert.equal(forbidden.response.status, 404);
  await ctx.request('/api/v1/auth/logout', { method: 'POST', body: {} });
  await ctx.request('/api/v1/auth/login', {
    method: 'POST',
    authenticated: false,
    body: { email: 'document-owner@example.test', password: 'correct-horse-battery' }
  });
  const deleted = await ctx.request(`/api/v1/cases/${caseId}/documents/${documentId}`, {
    method: 'DELETE', body: {}
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.result.reportsDeleted, 1);
  assert.deepEqual((await ctx.request(`/api/v1/cases/${caseId}/documents`)).result.items, []);
  assert.deepEqual((await ctx.request(`/api/v1/cases/${caseId}/reports`)).result.items, []);
  assert.deepEqual((await ctx.request(`/api/v1/cases/${caseId}/timeline`)).result.events, []);
});

test('research does not fabricate results and provides portal links with a clear warning', async (t) => {
  const ctx = await setup();
  t.after(ctx.cleanup);
  await ctx.register('researcher@example.test');
  const search = await ctx.request('/api/v1/research/search', {
    method: 'POST',
    body: { query: 'employment notice', jurisdiction: 'UAE_FEDERAL' }
  });
  assert.equal(search.response.status, 200);
  assert.deepEqual(search.result.results, []);
  assert.equal(search.result.status, 'legal_corpus_not_configured');
  assert.match(search.result.notice, /does not independently confirm/);
  assert.ok(search.result.portals.some((portal) => portal.url === 'https://uaelegislation.gov.ae/en'));
});

test('only administrator-attested official source versions become searchable and citation checks stay evidence-scoped', async (t) => {
  const ctx = await setup({ bootstrapToken: 'test-bootstrap-secret' });
  t.after(ctx.cleanup);
  const ordinary = await ctx.register('researcher@example.test');
  assert.equal(ordinary.result.user.role, 'user');
  await ctx.request('/api/v1/auth/logout', { method: 'POST', body: {} });
  const admin = await ctx.request('/api/v1/auth/register', {
    method: 'POST',
    authenticated: false,
    body: { email: 'admin@example.test', password: 'correct-horse-battery', bootstrapToken: 'test-bootstrap-secret' }
  });
  assert.equal(admin.result.user.role, 'admin');

  const source = await ctx.request('/api/v1/admin/legal-sources', {
    method: 'POST',
    body: {
      officialTitle: 'Example Federal Act',
      documentNumber: 'Federal Act No. 7 of 2024',
      issuingAuthority: 'Example authority',
      jurisdiction: 'UAE_FEDERAL',
      documentType: 'legislation',
      language: 'en',
      sourceUrl: 'https://uaelegislation.gov.ae/en/legislations/example',
      version: {
        versionLabel: 'Official text 2024',
        publicationDate: '2024-01-01',
        effectiveDate: '2024-01-15',
        expiryDate: '2024-12-31',
        amendmentStatus: 'consolidated',
        text: 'Article 1 Scope\nThis Act applies to commerce in the United Arab Emirates.\n\nArticle 2 Definitions\nFor this Act, a party means a legal person.'
      }
    }
  });
  assert.equal(source.response.status, 201);
  const version = source.result.item.versions[0];
  assert.equal(version.verificationStatus, 'pending_review');
  assert.equal(version.sha256.length, 64);
  const pendingSearch = await ctx.request('/api/v1/research/search', {
    method: 'POST',
    body: { query: 'commerce', jurisdiction: 'UAE_FEDERAL' }
  });
  assert.equal(pendingSearch.result.status, 'corpus_pending_review');
  assert.deepEqual(pendingSearch.result.results, []);

  const versionText = await ctx.request(`/api/v1/admin/legal-sources/${source.result.item.id}/versions/${version.id}`);
  assert.equal(versionText.response.status, 200);
  assert.match(versionText.result.item.originalText, /Article 2 Definitions/);
  const missingAttestation = await ctx.request(`/api/v1/admin/legal-sources/${source.result.item.id}/versions/${version.id}/review`, {
    method: 'POST',
    body: {
      reviewedSha256: version.sha256,
      reviewNote: 'Reviewed source text and official record.',
      checkedSourceUrl: true,
      checkedOriginalText: true,
      checkedDatesAndJurisdiction: false
    }
  });
  assert.equal(missingAttestation.response.status, 400);
  const reviewed = await ctx.request(`/api/v1/admin/legal-sources/${source.result.item.id}/versions/${version.id}/review`, {
    method: 'POST',
    body: {
      reviewedSha256: version.sha256,
      reviewNote: 'Compared official text, document number, dates, and jurisdiction.',
      checkedSourceUrl: true,
      checkedOriginalText: true,
      checkedDatesAndJurisdiction: true
    }
  });
  assert.equal(reviewed.response.status, 200);
  assert.equal(reviewed.result.status, 'reviewer_attested');
  assert.match(reviewed.result.notice, /does not independently confirm/);

  const search = await ctx.request('/api/v1/research/search', {
    method: 'POST',
    body: { query: 'commerce', jurisdiction: 'UAE_FEDERAL', relevantDate: '2024-05-01' }
  });
  assert.equal(search.result.status, 'results');
  assert.equal(search.result.results[0].articleNumber, '1');
  assert.match(search.result.results[0].excerpt, /commerce/);
  const citation = {
    legalSourceId: source.result.item.id,
    versionId: version.id,
    articleNumber: '1',
    jurisdiction: 'UAE_FEDERAL',
    relevantDate: '2024-05-01',
    quotedText: 'This Act applies to commerce in the United Arab Emirates.'
  };
  const verified = await ctx.request('/api/v1/citations/verify', { method: 'POST', body: citation });
  assert.equal(verified.result.status, 'verified');
  assert.equal(verified.result.quoteMatch, true);
  const mismatch = await ctx.request('/api/v1/citations/verify', {
    method: 'POST',
    body: { ...citation, quotedText: 'This Act applies to all transactions.' }
  });
  assert.equal(mismatch.result.status, 'not_found');
  assert.equal(mismatch.result.quoteMatch, false);
  const outdated = await ctx.request('/api/v1/citations/verify', {
    method: 'POST',
    body: { ...citation, relevantDate: '2025-01-01' }
  });
  assert.equal(outdated.result.status, 'outdated');
  const health = await ctx.request('/api/v1/health');
  assert.equal(health.result.legalCorpus.status, 'reviewer_attested');
  assert.ok(health.result.legalCorpus.attestedVersions === 1);
});

test('legal source controls reject non-admins, unapproved domains, bad dates, and duplicate immutable version labels', async (t) => {
  const ctx = await setup({ bootstrapToken: 'test-bootstrap-secret' });
  t.after(ctx.cleanup);
  await ctx.register('member@example.test');
  const forbidden = await ctx.request('/api/v1/admin/legal-sources');
  assert.equal(forbidden.response.status, 403);
  await ctx.request('/api/v1/auth/logout', { method: 'POST', body: {} });
  await ctx.request('/api/v1/auth/register', {
    method: 'POST',
    authenticated: false,
    body: { email: 'admin@example.test', password: 'correct-horse-battery', bootstrapToken: 'test-bootstrap-secret' }
  });
  const base = {
    officialTitle: 'Example Act',
    issuingAuthority: 'Example authority',
    jurisdiction: 'UAE_FEDERAL',
    documentType: 'legislation',
    language: 'en',
    sourceUrl: 'https://example.com/act',
    version: { versionLabel: '2024', effectiveDate: '2024-01-01', text: 'Article 1\nExample provision.' }
  };
  const unsafeUrl = await ctx.request('/api/v1/admin/legal-sources', { method: 'POST', body: base });
  assert.equal(unsafeUrl.response.status, 400);
  const invalidDate = await ctx.request('/api/v1/admin/legal-sources', {
    method: 'POST',
    body: {
      ...base,
      sourceUrl: 'https://uaelegislation.gov.ae/act',
      version: { ...base.version, effectiveDate: '2024-02-31' }
    }
  });
  assert.equal(invalidDate.response.status, 400);
  const created = await ctx.request('/api/v1/admin/legal-sources', {
    method: 'POST',
    body: { ...base, sourceUrl: 'https://uaelegislation.gov.ae/act' }
  });
  assert.equal(created.response.status, 201);
  const duplicate = await ctx.request(`/api/v1/admin/legal-sources/${created.result.item.id}/versions`, {
    method: 'POST',
    body: base.version
  });
  assert.equal(duplicate.response.status, 409);
  const noScope = await ctx.request('/api/v1/research/search', {
    method: 'POST',
    body: { query: 'provision', jurisdiction: 'UNKNOWN' }
  });
  assert.equal(noScope.result.status, 'jurisdiction_required');
});

test('Arabic source articles remain searchable and quote-checkable without translation', async (t) => {
  const ctx = await setup({ bootstrapToken: 'test-bootstrap-secret' });
  t.after(ctx.cleanup);
  const admin = await ctx.request('/api/v1/auth/register', {
    method: 'POST',
    authenticated: false,
    body: { email: 'admin@example.test', password: 'correct-horse-battery', bootstrapToken: 'test-bootstrap-secret' }
  });
  assert.equal(admin.result.user.role, 'admin');
  const text = 'المادة (1) النطاق\nتطبق أحكام هذا القانون على المعاملات التجارية.\n\nالمادة (2) التعاريف\nيقصد بالكلمة المعنى المحدد لها.';
  const created = await ctx.request('/api/v1/admin/legal-sources', {
    method: 'POST',
    body: {
      officialTitle: 'قانون تجريبي',
      issuingAuthority: 'جهة رسمية',
      jurisdiction: 'DUBAI_LOCAL',
      documentType: 'legislation',
      language: 'ar',
      sourceUrl: 'https://authority.gov.ae/legislation/example',
      version: {
        versionLabel: 'النص الأصلي',
        effectiveDate: '2024-01-01',
        expiryDate: '2030-01-01',
        amendmentStatus: 'consolidated',
        text
      }
    }
  });
  assert.equal(created.response.status, 201);
  const version = created.result.item.versions[0];
  const review = await ctx.request(`/api/v1/admin/legal-sources/${created.result.item.id}/versions/${version.id}/review`, {
    method: 'POST',
    body: {
      reviewedSha256: version.sha256,
      reviewNote: 'تمت مقارنة النص بالمصدر الرسمي والتحقق من التاريخ والاختصاص.',
      checkedSourceUrl: true,
      checkedOriginalText: true,
      checkedDatesAndJurisdiction: true
    }
  });
  assert.equal(review.response.status, 200);
  const search = await ctx.request('/api/v1/research/search', {
    method: 'POST',
    body: { query: 'المعاملات التجارية', jurisdiction: 'DUBAI_LOCAL', relevantDate: '2025-01-01' }
  });
  assert.equal(search.result.status, 'results');
  assert.equal(search.result.results[0].articleNumber, '1');
  const citation = await ctx.request('/api/v1/citations/verify', {
    method: 'POST',
    body: {
      legalSourceId: created.result.item.id,
      versionId: version.id,
      articleNumber: '1',
      jurisdiction: 'DUBAI_LOCAL',
      relevantDate: '2025-01-01',
      quotedText: 'تطبق أحكام هذا القانون على المعاملات التجارية.'
    }
  });
  assert.equal(citation.result.status, 'verified');
  assert.equal(citation.result.quoteMatch, true);
});

test('admin bootstrap is explicit and audit chain access is restricted and verifiable', async (t) => {
  const ctx = await setup({ bootstrapToken: 'test-bootstrap-secret' });
  t.after(ctx.cleanup);
  const admin = await ctx.request('/api/v1/auth/register', {
    method: 'POST',
    authenticated: false,
    body: { email: 'admin@example.test', password: 'correct-horse-battery', bootstrapToken: 'test-bootstrap-secret' }
  });
  assert.equal(admin.result.user.role, 'admin');
  const created = await ctx.request('/api/v1/cases', { method: 'POST', body: { title: 'Audit test' } });
  assert.equal(created.response.status, 201);
  const audit = await ctx.request('/api/v1/admin/audit');
  assert.equal(audit.response.status, 200);
  assert.equal(audit.result.integrity, 'valid');
  assert.ok(audit.result.items.some((item) => item.action === 'case.create'));
});

test('disabled signup still permits only the explicitly tokened bootstrap administrator', async (t) => {
  const ctx = await setup({ allowSignup: false, bootstrapToken: 'setup-only-secret' });
  t.after(ctx.cleanup);
  const ordinary = await ctx.register('ordinary@example.test');
  assert.equal(ordinary.response.status, 403);
  const bootstrap = await ctx.request('/api/v1/auth/register', {
    method: 'POST',
    authenticated: false,
    body: { email: 'setup@example.test', password: 'correct-horse-battery', bootstrapToken: 'setup-only-secret' }
  });
  assert.equal(bootstrap.response.status, 201);
  assert.equal(bootstrap.result.user.role, 'admin');
  const secondBootstrap = await ctx.request('/api/v1/auth/register', {
    method: 'POST',
    body: { email: 'second-admin@example.test', password: 'correct-horse-battery', bootstrapToken: 'setup-only-secret' }
  });
  assert.equal(secondBootstrap.response.status, 403);
});

test('audit integrity check detects a modified event and regular accounts cannot read it', async (t) => {
  const ctx = await setup({ bootstrapToken: 'test-bootstrap-secret' });
  t.after(ctx.cleanup);
  await ctx.register('member@example.test');
  const memberCase = await ctx.request('/api/v1/cases', { method: 'POST', body: { title: 'Audit source' } });
  await ctx.request(`/api/v1/cases/${memberCase.result.item.id}`);
  const forbidden = await ctx.request('/api/v1/admin/audit');
  assert.equal(forbidden.response.status, 403);
  await ctx.request('/api/v1/auth/logout', { method: 'POST', body: {} });
  const admin = await ctx.request('/api/v1/auth/register', {
    method: 'POST',
    authenticated: false,
    body: { email: 'admin@example.test', password: 'correct-horse-battery', bootstrapToken: 'test-bootstrap-secret' }
  });
  assert.equal(admin.result.user.role, 'admin');
  ctx.app.db.prepare("UPDATE audit_events SET details_json = '{\"tampered\":true}' WHERE action = 'case.read'").run();
  const tampered = await ctx.request('/api/v1/admin/audit');
  assert.equal(tampered.response.status, 500);
  assert.equal(tampered.result.error.code, 'AUDIT_CHAIN_INVALID');
});

test('login rejects invalid passwords and logout invalidates the session', async (t) => {
  const ctx = await setup();
  t.after(ctx.cleanup);
  await ctx.register('session@example.test');
  const logout = await ctx.request('/api/v1/auth/logout', { method: 'POST', body: {} });
  assert.equal(logout.response.status, 200);
  const login = await ctx.request('/api/v1/auth/login', {
    method: 'POST',
    authenticated: false,
    body: { email: 'session@example.test', password: 'incorrect-password' }
  });
  assert.equal(login.response.status, 401);
  const goodLogin = await ctx.request('/api/v1/auth/login', {
    method: 'POST',
    authenticated: false,
    body: { email: 'session@example.test', password: 'correct-horse-battery' }
  });
  assert.equal(goodLogin.response.status, 200);
  const me = await ctx.request('/api/v1/auth/me');
  assert.equal(me.result.user.email, 'session@example.test');
});

test('Gemini receives server-side credentials, returns source-checked output, and records usage', async (t) => {
  const apiKey = 'gemini-private-test-key';
  const quote = 'The supplier must provide 30 days notice.';
  let generationRequest;
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') {
      assert.equal(init.headers['x-goog-api-key'], apiKey);
      return new Response(JSON.stringify({ name: 'models/gemini-4-carbon' }), { status: 200 });
    }
    generationRequest = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        summary: 'The supplied text includes a notice period.',
        sections: [{ heading: 'Observation', content: 'A notice period appears in the source text.' }],
        observations: [{
          documentId: generationRequest.body.contents[0].parts[0].text.match(/"documentId":"([^"]+)"/)[1],
          exactQuote: quote,
          observation: 'A notice period is stated.',
          uncertainty: 'The text alone does not establish legal effect.'
        }],
        uncertainties: ['The applicable legal framework has not been verified.']
      }) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30 }
    }), { status: 200 });
  };
  const ctx = await setup({
    bootstrapToken: 'bootstrap-test-secret',
    env: {
      GEMINI_API_KEY: apiKey, GEMINI_MODEL: 'gemini-4-carbon',
      GEMINI_INPUT_USD_PER_MILLION: '2', GEMINI_OUTPUT_USD_PER_MILLION: '8'
    },
    fetchImpl
  });
  t.after(ctx.cleanup);
  const registered = await ctx.request('/api/v1/auth/register', {
    method: 'POST', authenticated: false,
    body: { email: 'admin@example.test', password: 'correct-horse-battery', bootstrapToken: 'bootstrap-test-secret' }
  });
  assert.equal(registered.result.user.role, 'admin');
  const config = await ctx.request('/api/v1/admin/ai');
  assert.equal(config.result.providers.gemini.apiKeyConfigured, true);
  assert.equal(config.result.providers.gemini.model, 'gemini-4-carbon');
  assert.equal(JSON.stringify(config.result).includes(apiKey), false);
  const keyMutation = await ctx.request('/api/v1/admin/ai', {
    method: 'PUT',
    body: { providers: { gemini: { model: 'gemini-4-carbon', apiKey: 'browser-supplied-secret' } } }
  });
  assert.equal(keyMutation.response.status, 400);
  const connection = await ctx.request('/api/v1/admin/ai/test', { method: 'POST', body: {} });
  assert.equal(connection.result.results.gemini.status, 'available');
  const created = await ctx.request('/api/v1/cases', { method: 'POST', body: { title: 'Provider test' } });
  const document = await ctx.request(`/api/v1/cases/${created.result.item.id}/documents`, {
    method: 'POST',
    body: { filename: 'source.txt', mediaType: 'text/plain', content: `Section: ${quote}` }
  });
  const result = await ctx.request(`/api/v1/cases/${created.result.item.id}/ai-analysis`, {
    method: 'POST', body: { task: 'document_analysis' }
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.result.report.provider, 'gemini');
  assert.equal(result.result.report.sections[0].heading, 'Observation');
  assert.equal(result.result.report.observations[0].documentId, document.result.item.id);
  assert.equal(result.result.report.observations[0].verification, 'quote_match_only_not_legal_verification');
  assert.equal(result.result.report.usage.estimatedCostUsd, 0.00044);
  assert.equal(generationRequest.headers['x-goog-api-key'], apiKey);
  assert.equal(JSON.stringify(generationRequest.body).includes(apiKey), false);
  const usage = await ctx.request('/api/v1/ai/usage');
  assert.equal(usage.result.items[0].provider, 'gemini');
  assert.equal(usage.result.items[0].inputTokens, 100);
});

test('admin configuration keeps Gemini as the only supported provider', async (t) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (init.method === 'GET' && url.includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({ name: 'models/gemini-4-carbon' }), { status: 200 });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        summary: 'Summary from Gemini only.',
        sections: [{ heading: 'Source note', content: 'Payment text is present.' }],
        observations: [{
          documentId: '00000000-0000-4000-8000-000000000001',
          exactQuote: 'Payment is due in June.',
          observation: 'A payment date is mentioned.',
          uncertainty: 'The date format is not further specified.'
        }],
        uncertainties: []
      }) }] } }],
      usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 }
    }), { status: 200 });
  };
  const ctx = await setup({
    bootstrapToken: 'bootstrap-test-secret',
    env: { GEMINI_API_KEY: 'gemini-key', GEMINI_MODEL: 'gemini-4-carbon' },
    fetchImpl
  });
  t.after(ctx.cleanup);
  await ctx.request('/api/v1/auth/register', {
    method: 'POST', authenticated: false,
    body: { email: 'admin@example.test', password: 'correct-horse-battery', bootstrapToken: 'bootstrap-test-secret' }
  });
  const connection = await ctx.request('/api/v1/admin/ai/test', { method: 'POST', body: {} });
  assert.equal(connection.result.results.gemini.status, 'available');
  const configured = await ctx.request('/api/v1/admin/ai', {
    method: 'PUT',
    body: { taskRoutes: { document_analysis: ['gemini'] } }
  });
  assert.equal(configured.response.status, 200);
  assert.deepEqual(configured.result.taskRoutes.document_analysis, ['gemini']);
  const bad = await ctx.request('/api/v1/admin/ai', {
    method: 'PUT',
    body: { taskRoutes: { document_analysis: ['gemini', 'secondary-provider'] } }
  });
  assert.equal(bad.response.status, 400);
  assert.ok(calls.some((url) => url.includes('generativelanguage.googleapis.com')));
});

test('provider errors return an explicit unavailable response without storing fabricated output', async (t) => {
  let requests = 0;
  const apiKey = 'failure-test-key';
  const ctx = await setup({
    env: { GEMINI_API_KEY: apiKey, GEMINI_MODEL: 'gemini-4-carbon' },
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: 'provider down' }), { status: 503 });
    }
  });
  t.after(ctx.cleanup);
  await ctx.register('user@example.test');
  const created = await ctx.request('/api/v1/cases', { method: 'POST', body: { title: 'Failure case' } });
  await ctx.request(`/api/v1/cases/${created.result.item.id}/documents`, {
    method: 'POST', body: { filename: 'source.txt', content: 'A source passage.' }
  });
  const result = await ctx.request(`/api/v1/cases/${created.result.item.id}/ai-analysis`, {
    method: 'POST', body: { task: 'document_analysis' }
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.result.error.code, 'AI_SERVICE_UNAVAILABLE');
  assert.equal(result.result.providerError, 'PROVIDER_HTTP_ERROR');
  assert.equal(JSON.stringify(result.result).includes(apiKey), false);
  assert.equal(requests, 2);
  const reports = await ctx.request(`/api/v1/cases/${created.result.item.id}/reports`);
  assert.equal(reports.result.items.length, 0);
});

test('model router rejects provider claims whose evidence quote is not in the case documents', async (t) => {
  const ctx = await setup({
    env: { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-4-carbon' },
    fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        summary: 'Unsupported claim.',
        sections: [],
        observations: [{
          documentId: '00000000-0000-4000-8000-000000000000',
          exactQuote: 'Invented source text.',
          observation: 'Unsupported.',
          uncertainty: 'None.'
        }],
        uncertainties: []
      }) }] } }]
    }), { status: 200 })
  });
  t.after(ctx.cleanup);
  await ctx.register('user@example.test');
  const created = await ctx.request('/api/v1/cases', { method: 'POST', body: { title: 'Validation case' } });
  await ctx.request(`/api/v1/cases/${created.result.item.id}/documents`, {
    method: 'POST', body: { filename: 'source.txt', content: 'Actual source text.' }
  });
  const result = await ctx.request(`/api/v1/cases/${created.result.item.id}/ai-analysis`, {
    method: 'POST', body: { task: 'document_analysis' }
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.result.providerError, 'UNSUPPORTED_AI_EVIDENCE');
  const usage = await ctx.request('/api/v1/ai/usage');
  assert.equal(usage.result.items.length, 0);
});
