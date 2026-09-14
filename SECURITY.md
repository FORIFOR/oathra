# Security policy

## Supported versions

Security fixes are made against the `main` branch and the latest tagged release. Older release assets remain available for reproducibility but may not receive fixes.

## Reporting a vulnerability

Please do not open a public issue with credentials, phone numbers, call audio, transcripts containing personal information, or an exploit that is not yet fixed.

If private vulnerability reporting is available in the repository, use GitHub's **Report a vulnerability** action under the [Security](https://github.com/FORIFOR/oathra/security) tab. If that action is unavailable, open a public issue with the short request **private security contact needed** and no technical details. We will use that issue to establish a private channel before details are shared.

Include the affected version or commit, the smallest reproducible description, impact, and any safe mitigation. Redact secrets and personal data. We do not require a real phone call to investigate a report; a synthetic or redacted transcript is preferred.

## Scope and data handling

Oathra can pass audio or transcripts to the providers selected by the operator and stores call artifacts on the machine running it. The browser checker keeps entered text in the browser. Do not submit private call data to public trackers. The consent-based intake feature records only contract-declared explicit answers and does not infer callee attributes or sensitive traits.
