# First public release

ApplyPilot currently has a working local application workflow. The first public release remains gated on the platform, integration and review work in the [architecture plan](architecture.md).

1. Run the complete workflow with synthetic resumes, job sources, provider responses, and application forms. Verify manual completion and approval requirements without submitting a real application.
2. Run the native and Docker installation matrix on supported operating systems, along with upgrade and restore tests. Record versions and platform-specific limitations.
3. Complete the security and accessibility reviews. Check credential storage, outbound consent, untrusted inputs, file upload limits, backups, and browser actions. Resolve release-blocking findings.
4. Set the public repository URL and private reporting channels. Review the MIT license, contribution instructions, dependency checks, example configuration, and screenshots.
5. Review all files for personal data and credentials. Push to the designated GitHub repository, verify its CI and enable private vulnerability reporting.
6. Tag the verified commit and publish release notes with exact installation instructions, known limitations, and the tested platform matrix.
