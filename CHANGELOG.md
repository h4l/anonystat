# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [0.3.0] - 2024-07-07

### Added

- The CORS allow origin config now allows literal URLs with non-standard
  schemes, such as chrome-extension:// or moz-extension://.
  (https://github.com/h4l/anonystat/pull/4)

## [0.2.0] - 2024-06-26

### Added

- Support for CORS requests — data streams can configure HTTP origins allowed to
  make CORS requests, which enables browsers to submit events using AJAX and
  `navigator.sendBeacon()` requests. (https://github.com/h4l/anonystat/pull/3)

## [0.1.0] — 2024-05-20

### Added

- Initial release
- HTTP server implementing Google Analytics 4 Measurement Protocol
  - Forward `/mp/collect` requests for allow-listed data stream measurement IDs
  - Anonymise clients submitting events by deterministically randomising their
    `user_id` values, and not exposing their IP address to the upstream Google
    Analytics service.
  - Event payload validation
- Config validation, format conversion and normalisation

[unreleased]: https://github.com/h4l/anonystat/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/h4l/anonystat/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/h4l/anonystat/releases/tag/v0.1.0
