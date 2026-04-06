## [1.3.2](https://github.com/wyre-technology/datto-rmm-mcp/compare/v1.3.1...v1.3.2) (2026-04-06)


### Bug Fixes

* move npm prune to builder stage for GitHub Packages auth ([41cfa26](https://github.com/wyre-technology/datto-rmm-mcp/commit/41cfa26266788583559e55b12c228b717f87de3d))

## [1.3.1](https://github.com/wyre-technology/datto-rmm-mcp/compare/v1.3.0...v1.3.1) (2026-03-31)


### Bug Fixes

* **deploy:** replace node_compat with nodejs_compat for Wrangler v4 ([752a249](https://github.com/wyre-technology/datto-rmm-mcp/commit/752a24921f3517bbf9dffca00d30ac96116aef8e))

# [1.3.0](https://github.com/wyre-technology/datto-rmm-mcp/compare/v1.2.0...v1.3.0) (2026-03-10)


### Features

* **elicitation:** add MCP elicitation support with graceful fallback ([fca1479](https://github.com/wyre-technology/datto-rmm-mcp/commit/fca14798350c78a5e84a95b28481bdf0a65c84b1))

# [1.2.0](https://github.com/wyre-technology/datto-rmm-mcp/compare/v1.1.1...v1.2.0) (2026-03-02)


### Bug Fixes

* **ci:** add GitHub Packages auth for npm ci ([574198b](https://github.com/wyre-technology/datto-rmm-mcp/commit/574198b1d17ffc688c9ac502635b4689ace8c67c))
* **ci:** convert pack-mcpb.js to ESM imports ([eb2f349](https://github.com/wyre-technology/datto-rmm-mcp/commit/eb2f349fc5ae0dc640961777b52e189bf3f09dc5))
* **ci:** fix broken YAML in Discord notification step ([8670d5e](https://github.com/wyre-technology/datto-rmm-mcp/commit/8670d5ece681b99f5ab43d0e5f93ea1d19815b16))
* **ci:** move Discord notification into release workflow ([63fe7f1](https://github.com/wyre-technology/datto-rmm-mcp/commit/63fe7f1ead2412c214a3ade591f1abcc6344f21c))
* **ci:** update lock file and bump node to 22 ([f44d087](https://github.com/wyre-technology/datto-rmm-mcp/commit/f44d0874d5947c3a40370f565d89c5a7dccf4ecf))
* **docker:** drop arm64 platform to fix QEMU build failures ([260696b](https://github.com/wyre-technology/datto-rmm-mcp/commit/260696bce3fe3870a938e9e83b7b7724e62f84d4))
* escape newlines in .releaserc.json message template ([a075b20](https://github.com/wyre-technology/datto-rmm-mcp/commit/a075b20f372c57198523b379a7df7251872f4746))
* quote MCPB bundle filename to prevent shell glob expansion failure ([fb01e0b](https://github.com/wyre-technology/datto-rmm-mcp/commit/fb01e0b19cd61b8f96863a297362e1589b51770b))
* rename duplicate step id 'version' to 'release-version' in docker job ([02889f8](https://github.com/wyre-technology/datto-rmm-mcp/commit/02889f85566e957012e90f2e82ef7083e6398b97))
* use Docker build secret for GitHub Packages auth in Dockerfile ([c3f17a5](https://github.com/wyre-technology/datto-rmm-mcp/commit/c3f17a58f923d2908f6aa491f39ad501a4441be2))
* use stateless per-request server pattern for HTTP transport ([802cf57](https://github.com/wyre-technology/datto-rmm-mcp/commit/802cf576c72791ac701befe8ba822f26fe7f46f9))


### Features

* add HTTP transport + gateway auth mode support ([036320d](https://github.com/wyre-technology/datto-rmm-mcp/commit/036320d131575b0e78842b8c5b0b8992cfefc7e5))
* add MCPB manifest for desktop installation ([93393d5](https://github.com/wyre-technology/datto-rmm-mcp/commit/93393d5e2c63f8a8771ac8c3af03ba68ed115a48))
* add MCPB pack script ([69ccd84](https://github.com/wyre-technology/datto-rmm-mcp/commit/69ccd842c3315f9cd7fee72278b733de44440fbf))
* add mcpb packaging support ([578ca6d](https://github.com/wyre-technology/datto-rmm-mcp/commit/578ca6dd19a89c62cf872d67ea40afca204f01a3))
* add mcpb packaging support ([bae3423](https://github.com/wyre-technology/datto-rmm-mcp/commit/bae34233dbd70045397a083736f5b7589f5f718c))
* add mcpb packaging support ([a94b358](https://github.com/wyre-technology/datto-rmm-mcp/commit/a94b3584ec5237546b86f10cd8e1263bf5ea4c13))
* add mcpb packaging support ([fae6e8f](https://github.com/wyre-technology/datto-rmm-mcp/commit/fae6e8f0ac6ea9a74252e03eb2f689bac4d29906))
* add mcpb packaging support ([dd5a8c8](https://github.com/wyre-technology/datto-rmm-mcp/commit/dd5a8c8cbc8e2904b4533600af4ea494acf7e8c4))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of Datto RMM MCP server
- Device management tools: `datto_list_devices`, `datto_get_device`
- Alert management tools: `datto_list_alerts`, `datto_resolve_alert`
- Site management tools: `datto_list_sites`, `datto_get_site`
- Quick job execution: `datto_run_quickjob`
- Audit data retrieval: `datto_get_device_audit`
- Support for all 6 Datto RMM platforms
- Docker support
- CI/CD with GitHub Actions
- Semantic release automation
