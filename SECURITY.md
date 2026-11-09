# Security policy

ApplyPilot is currently a local single-user development release. Keep the frontend bound to loopback and the API private. Treat the application database, backups and future document files as private workspace data. On a shared computer use a separate OS account and restrict filesystem access to its workspace directory.

Phase 1 restricts the frontend API to a fixed set of routes, checks the configured browser origin for settings writes, and rejects untrusted API hosts. It uses a mutation header and sends no cross-origin allowances. Local programs with access to the account or service are inside the trust boundary.

Report vulnerabilities privately through GitHub's **Report a vulnerability** feature once enabled for the public repository. Include the affected version, reproduction steps and impact using synthetic data. Keep credentials and real candidate records out of reports.

Resume files are parsed in a timed subprocess with upload and extraction limits. Provider keys are encrypted locally. The default key file sits beside the workspace database under OS filesystem permissions, so access to both files is inside the local trust boundary. An environment-supplied key can keep them separate. Exported backups remove credentials and pause automation. Backups still contain personal records and should be kept private.

User-configured provider connections and RSS feeds use fixed vendor endpoints or exact local allowlists. Candidate data sharing needs provider consent and an explicit AI preparation action. Manual application approval records the reviewed package and enables the employer link. Users complete and submit applications on the employer site.
