# Security and privacy notes

## Scope and assurance

LEXORA is an early local demonstration, not a certified or independently assessed legal system. It is not a legal authority, compliance product, or “military grade” deployment. No certification, legal compliance claim, or authoritative legal conclusion is made. Do not deploy this project for sensitive, privileged, classified, or production legal workloads without additional review, controls, and independent auditing.

## Implemented controls

- Passwords use Node's scrypt KDF with per-user random salts; plaintext passwords are not stored.
- Session secrets are random, opaque, stored as SHA-256 digests, expire after eight hours, and are sent in `HttpOnly`, `SameSite=Strict` cookies. Cookies are marked `Secure` in production mode.
- Authenticated state changes require a per-session CSRF token. There is no permissive CORS configuration.
- Case and document queries include the authenticated owner ID; non-owned case identifiers return the same not-found response as unknown IDs.
- SQLite foreign keys, parameterized statements, content-type and body-size checks, filename/type restrictions, character limits, CSP, and common security headers are enabled.
- The default listener binds to loopback. The optional initial administrator requires a separately configured bootstrap secret; self-registered accounts do not receive elevated privileges.
- Audit events avoid storing document text and use a hash-linked chain. Admin access checks the chain before disclosure.
- Document deletion is scoped to an owned case, CSRF protected, audit logged, and removes stored analysis reports that cite or list the deleted document to prevent stale content retention.
- The app renders document text as escaped text and only sends selected case content to the configured Gemini generation endpoint. No API keys are exposed in browser code or frontend config.
- Only Google Gemini is used as a generative AI provider. Machine learning is implemented as a separate retrieval and similarity layer using a multilingual embedding model; it is not a legal authority and is not used to generate legal conclusions.
- AI outputs must pass a bounded JSON schema and exact source-quote check before they are stored as successful reports. Quote presence does not establish legal meaning, truth, or authority.
- Provider calls have bounded timeouts, one retry for transient failures, explicit service-unavailable responses, and logged usage/cost estimates. Token usage is recorded; cost remains null unless server-side price rates are configured.
- The legal-source library accepts only HTTPS URLs on allowlisted UAE-government, DIFC Courts, and ADGM domains; it does not fetch submitted URLs. Source text versions are immutable through the app, SHA-256 hashed, and searchable only after administrator review. Quote checks are deterministic text comparisons using Unicode NFC and whitespace normalization.
- Source review requires separate administrator attestations for the official URL, original text, and dates/jurisdiction, plus the exact reviewed hash. Review events are audit logged. This records a human assertion; it is not a trusted signature, external source validation, or legal approval.

## Known gaps and safe operation

- Local SQLite rows, including uploaded document contents, are not encrypted at rest. Use only non-sensitive synthetic material. Production requires separately managed encryption keys, encrypted database/storage, backups, and tested restoration.
- The audit chain is local and can be recomputed by anyone able to rewrite the database. Production requires remote, access-controlled, retention-protected audit storage.
- Authentication has no MFA, email verification, password reset/recovery, identity-provider integration, or distributed rate limiting. The in-memory login limiter does not coordinate across processes.
- Production self-registration should be disabled (`LEXORA_ALLOW_SIGNUP=false`) until an approved identity and provisioning flow exists. Set `NODE_ENV=production` only behind correctly configured HTTPS termination.
- There is no malware scanner, OCR/PDF/DOCX parser, formal input fuzzing, dependency scanner, penetration test, privacy/legal review, or incident-response integration.
- Legal material is manually entered by an administrator; it is not an authoritative legal database, and there is no independent legal-corpus provenance service or citation-verification pipeline. A stored source can be incomplete, stale, mis-transcribed, or misclassified despite reviewer attestation. Search is heuristic and source-aware, not legal certainty.
- Source versions are not editable through application routes, but SQLite is not tamper-proof; an operator able to alter the database can change stored sources and recompute local audit hashes.
- Provider connectivity and model access require valid server secrets, account permissions, network egress, and currently available models. The implementation's mocked tests do not establish live provider availability.
- Analyze only data approved for external processing under the current Gemini terms and applicable data-handling agreements. Do not upload sensitive data until provider retention, region, processing, deletion, and cross-border transfer settings have been reviewed by qualified personnel.
- Do not add a model provider without an explicit allowlist, tenant/data-handling review, prompt-injection isolation, retention review, bounded tool permissions, and structured evidence validation.

## Secret handling

Set `GEMINI_API_KEY` in the backend deployment secret manager and configure `GEMINI_MODEL` (or an administrator-controlled model overrides). Never commit a populated `.env`, copy keys into frontend code, expose them through a public configuration endpoint, or send them in provider-configuration API requests.

Provider documentation: [Gemini API](https://ai.google.dev/gemini-api/docs).

Report security issues privately to the project owner. Do not include real personal data or confidential documents in bug reports.
