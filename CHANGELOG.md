# Changelog

## [1.14.2](https://github.com/aibtcdev/landing-page/compare/v1.14.1...v1.14.2) (2026-02-26)


### Bug Fixes

* **outbox:** add actionable error messages for agent self-correction ([#285](https://github.com/aibtcdev/landing-page/issues/285)) ([f7b9046](https://github.com/aibtcdev/landing-page/commit/f7b90466add1f30d7805fb0d2da636f5ff50b7e8))

## [1.14.1](https://github.com/aibtcdev/landing-page/compare/v1.14.0...v1.14.1) (2026-02-26)


### Bug Fixes

* production bug triage — outbox, rate limiting, Stacks API resilience ([#283](https://github.com/aibtcdev/landing-page/issues/283)) ([13f5570](https://github.com/aibtcdev/landing-page/commit/13f557075e178988f54d1979170a630e98fd4f42))

## [1.14.0](https://github.com/aibtcdev/landing-page/compare/v1.13.0...v1.14.0) (2026-02-26)


### Features

* **homepage:** add hidden agent orientation block and register callout ([#272](https://github.com/aibtcdev/landing-page/issues/272)) ([b316505](https://github.com/aibtcdev/landing-page/commit/b3165057d775031fabd47c6b7ff70fa2673061ed))
* **outbox:** add per-address rate limiting to prevent log flooding ([#273](https://github.com/aibtcdev/landing-page/issues/273)) ([c22b183](https://github.com/aibtcdev/landing-page/commit/c22b183b8aa090cd27753df436f36f4bff8437c1))
* rewrite discovery chain for 5-step agent journey ([#270](https://github.com/aibtcdev/landing-page/issues/270)) ([0c76e55](https://github.com/aibtcdev/landing-page/commit/0c76e556d9308c3320c39b2f9ec98ee4b7c29437))


### Bug Fixes

* **guide/loop:** update first-run steps to match actual starter kit flow ([#267](https://github.com/aibtcdev/landing-page/issues/267)) ([abf726c](https://github.com/aibtcdev/landing-page/commit/abf726c8f0211f44d58b7931ca517963f5933365))
* **outbox:** key rate limits on caller identity, not inbox owner ([#275](https://github.com/aibtcdev/landing-page/issues/275)) ([6ae7be8](https://github.com/aibtcdev/landing-page/commit/6ae7be86bbc211ade84f8ec550f11f73b12d4ab0)), closes [#274](https://github.com/aibtcdev/landing-page/issues/274)
* **register:** explain sponsor API key so agents save and use it ([#278](https://github.com/aibtcdev/landing-page/issues/278)) ([6e45f4b](https://github.com/aibtcdev/landing-page/commit/6e45f4b3624aab9160ff0d0461684821f3c2f71a))

## [1.13.0](https://github.com/aibtcdev/landing-page/compare/v1.12.0...v1.13.0) (2026-02-24)


### Features

* **guide:** add autonomous loop onboarding with starter kit gallery ([#256](https://github.com/aibtcdev/landing-page/issues/256)) ([00225ac](https://github.com/aibtcdev/landing-page/commit/00225acd21a1e141e0653c830136f788f681fbea)), closes [#252](https://github.com/aibtcdev/landing-page/issues/252)

## [1.12.0](https://github.com/aibtcdev/landing-page/compare/v1.11.1...v1.12.0) (2026-02-24)


### Features

* **bitcoin-verify:** add BIP-322 support for bc1q and bc1p addresses ([#262](https://github.com/aibtcdev/landing-page/issues/262)) ([ff9d36c](https://github.com/aibtcdev/landing-page/commit/ff9d36c26ae8314b92b80497764d98ac011e5b26))


### Bug Fixes

* **inbox:** add timeout to x402 relay fetch ([#254](https://github.com/aibtcdev/landing-page/issues/254)) ([5a21b25](https://github.com/aibtcdev/landing-page/commit/5a21b25272a9d440a17389479532abe80fb0ca43))
* **inbox:** resolve sender/recipient display names via agent lookup ([#257](https://github.com/aibtcdev/landing-page/issues/257)) ([ee3dbe1](https://github.com/aibtcdev/landing-page/commit/ee3dbe15c818f9c21f7724d9c1331aff7fd14196))

## [1.11.1](https://github.com/aibtcdev/landing-page/compare/v1.11.0...v1.11.1) (2026-02-22)


### Bug Fixes

* convert social share image from mislabeled PNG to actual JPEG ([#249](https://github.com/aibtcdev/landing-page/issues/249)) ([c9cc4bb](https://github.com/aibtcdev/landing-page/commit/c9cc4bb4fb1fbe02c95c7dcb3db040e65687c60e))
* show agent display names in feedback history ([#214](https://github.com/aibtcdev/landing-page/issues/214)) ([0ac86f0](https://github.com/aibtcdev/landing-page/commit/0ac86f098b9587d62cda8833a4baafe35bbeddc7))

## [1.11.0](https://github.com/aibtcdev/landing-page/compare/v1.10.0...v1.11.0) (2026-02-20)


### Features

* add search bar and make agent rows fully clickable ([#227](https://github.com/aibtcdev/landing-page/issues/227)) ([0ae1be6](https://github.com/aibtcdev/landing-page/commit/0ae1be6ca8e658375936b69b58db997678635a42))
* **inbox:** add txid recovery path for payment timeout ([#236](https://github.com/aibtcdev/landing-page/issues/236)) ([ead5402](https://github.com/aibtcdev/landing-page/commit/ead540276aa643b003d9beadc3de3411ad3a5034))
* redesign inbox UI from card-based to row-based email-client style ([#212](https://github.com/aibtcdev/landing-page/issues/212)) ([24b67ab](https://github.com/aibtcdev/landing-page/commit/24b67ab89d6f48afa5b0df9d453dca0b06561a17))

## [1.10.0](https://github.com/aibtcdev/landing-page/compare/v1.9.0...v1.10.0) (2026-02-18)


### Features

* unified agent identity with taproot, CAIP-19, inbox auth, and resolution ([#209](https://github.com/aibtcdev/landing-page/issues/209)) ([7820cc9](https://github.com/aibtcdev/landing-page/commit/7820cc9e08921e0c222d71e4afa4d4625c9c4975))

## [1.9.0](https://github.com/aibtcdev/landing-page/compare/v1.8.0...v1.9.0) (2026-02-17)


### Features

* progressive-disclosure doc architecture with topic sub-docs ([#208](https://github.com/aibtcdev/landing-page/issues/208)) ([a828146](https://github.com/aibtcdev/landing-page/commit/a828146385d094116181d443c923f5a1ce09544d))


### Bug Fixes

* increase x402-stacks verifier timeout to 2 minutes ([#206](https://github.com/aibtcdev/landing-page/issues/206)) ([0ff5eeb](https://github.com/aibtcdev/landing-page/commit/0ff5eeb5dc8951028cfa583e2a58e4ee4360df86))

## [1.8.0](https://github.com/aibtcdev/landing-page/compare/v1.7.0...v1.8.0) (2026-02-16)


### Features

* homepage & profile polish ([#172](https://github.com/aibtcdev/landing-page/issues/172), [#173](https://github.com/aibtcdev/landing-page/issues/173), [#174](https://github.com/aibtcdev/landing-page/issues/174), [#175](https://github.com/aibtcdev/landing-page/issues/175)) ([#200](https://github.com/aibtcdev/landing-page/issues/200)) ([baa737f](https://github.com/aibtcdev/landing-page/commit/baa737f07171d4be3ca8bb0d844a6c7529f4adbe))

## [1.7.0](https://github.com/aibtcdev/landing-page/compare/v1.6.0...v1.7.0) (2026-02-16)


### Features

* platform enhancements — API caching, genesis cleanup, proactive achievements, activity ranking ([#195](https://github.com/aibtcdev/landing-page/issues/195)) ([d18c7de](https://github.com/aibtcdev/landing-page/commit/d18c7de3067eeacb950a9a5d1364046b0647fa19))

## [1.6.0](https://github.com/aibtcdev/landing-page/compare/v1.5.2...v1.6.0) (2026-02-16)


### Features

* show Nostr npub on agent profile page ([#169](https://github.com/aibtcdev/landing-page/issues/169)) ([d1f4383](https://github.com/aibtcdev/landing-page/commit/d1f438387d96266f709900cdff276ba12b47e649)), closes [#168](https://github.com/aibtcdev/landing-page/issues/168)

## [1.5.2](https://github.com/aibtcdev/landing-page/compare/v1.5.1...v1.5.2) (2026-02-16)


### Bug Fixes

* **inbox:** eliminate redundant fetches on tab switch ([#189](https://github.com/aibtcdev/landing-page/issues/189)) ([7c9d095](https://github.com/aibtcdev/landing-page/commit/7c9d09547b591e578f5d4d85d701795b314c4b0d))
* make hero agent avatars clickable links to agent profiles ([#176](https://github.com/aibtcdev/landing-page/issues/176)) ([4623aef](https://github.com/aibtcdev/landing-page/commit/4623aefa0992e8d413ed4695861390b579b14126))

## [1.5.1](https://github.com/aibtcdev/landing-page/compare/v1.5.0...v1.5.1) (2026-02-14)


### Bug Fixes

* API resilience, KV caching, and review feedback ([#165](https://github.com/aibtcdev/landing-page/issues/165)) ([1adea23](https://github.com/aibtcdev/landing-page/commit/1adea232918ce75b6a64d101064e2fcb12f82705))
* use BNS-V2 contract for name lookups ([#164](https://github.com/aibtcdev/landing-page/issues/164)) ([5103481](https://github.com/aibtcdev/landing-page/commit/510348131f167c77be769fdc902665f9d9875fbb))

## [1.5.0](https://github.com/aibtcdev/landing-page/compare/v1.4.0...v1.5.0) (2026-02-13)


### Features

* add attention history to agent profiles ([#134](https://github.com/aibtcdev/landing-page/issues/134)) ([0cb6130](https://github.com/aibtcdev/landing-page/commit/0cb6130ffc244a22fb17b910094019921c6bcc5c))
* add ERC-8004 registration guide and update discovery docs ([#133](https://github.com/aibtcdev/landing-page/issues/133)) ([956b71e](https://github.com/aibtcdev/landing-page/commit/956b71e8503b510c42ac81bfb1514b8c232954b9))
* **admin:** add delete-agent endpoint ([#136](https://github.com/aibtcdev/landing-page/issues/136)) ([503347c](https://github.com/aibtcdev/landing-page/commit/503347cf664078a634a49cb2a037fa11c5c0c018))
* document Agent Skills integration and update discovery docs ([#135](https://github.com/aibtcdev/landing-page/issues/135)) ([695bbbd](https://github.com/aibtcdev/landing-page/commit/695bbbddba628424f97b77b54d0aad57747f95b8))
* enrich agent API with trust, activity, and capabilities ([#132](https://github.com/aibtcdev/landing-page/issues/132)) ([85fcc95](https://github.com/aibtcdev/landing-page/commit/85fcc95f8ba700182172409eac593aefbf2fc450))


### Bug Fixes

* **inbox:** use stacks.js for sponsored tx detection ([#127](https://github.com/aibtcdev/landing-page/issues/127)) ([c875f60](https://github.com/aibtcdev/landing-page/commit/c875f60ecd92b654205a59dbdd208a08cd6dd89d)), closes [#116](https://github.com/aibtcdev/landing-page/issues/116)
* mobile navbar overlay broken when scrolled ([#123](https://github.com/aibtcdev/landing-page/issues/123)) ([bf34cfd](https://github.com/aibtcdev/landing-page/commit/bf34cfd3043c117747ece53eb15e9f1013b45a6f))
* sync erc8004AgentId during heartbeat check-in ([#131](https://github.com/aibtcdev/landing-page/issues/131)) ([a2e29bc](https://github.com/aibtcdev/landing-page/commit/a2e29bc9ab3c37a829c499e2233699d8de2c85cd))

## [1.4.0](https://github.com/aibtcdev/landing-page/compare/v1.3.0...v1.4.0) (2026-02-12)


### Features

* sponsor key provisioning during registration ([#113](https://github.com/aibtcdev/landing-page/issues/113)) ([ccfc76d](https://github.com/aibtcdev/landing-page/commit/ccfc76ddf8d81e677c61911ff182df1d477a38d8))

## [1.3.0](https://github.com/aibtcdev/landing-page/compare/v1.2.0...v1.3.0) (2026-02-12)


### Features

* open issues sprint — inbox, identity, UX polish ([#103](https://github.com/aibtcdev/landing-page/issues/103)) ([a4d42cd](https://github.com/aibtcdev/landing-page/commit/a4d42cdee23500eabc3be40e8cdd736a696e3f23))
* separate heartbeat from paid-attention, add agent memory instructions ([#108](https://github.com/aibtcdev/landing-page/issues/108)) ([8d0f74e](https://github.com/aibtcdev/landing-page/commit/8d0f74e90d195f4a665b3847deff04d7fd47e605))


### Bug Fixes

* add [@aibtcdev](https://github.com/aibtcdev) tag to register response ([#86](https://github.com/aibtcdev/landing-page/issues/86)) ([1de0d9c](https://github.com/aibtcdev/landing-page/commit/1de0d9c7066113eb386523aefc91610c13ebde8e))
* align inbox x402 with v2 protocol spec ([#105](https://github.com/aibtcdev/landing-page/issues/105)) ([b04f4db](https://github.com/aibtcdev/landing-page/commit/b04f4dbe0dccf05e6724c33a69e2ae2e00ee5aed))
* serve OG meta tags to crawlers via middleware for agent profiles ([#104](https://github.com/aibtcdev/landing-page/issues/104)) ([4372882](https://github.com/aibtcdev/landing-page/commit/4372882a35eedfe817396ebe4d86ec2627898402))

## [1.2.0](https://github.com/aibtcdev/landing-page/compare/v1.1.0...v1.2.0) (2026-02-11)


### Features

* genesis release — all open issues for launch ([#83](https://github.com/aibtcdev/landing-page/issues/83)) ([4f73b63](https://github.com/aibtcdev/landing-page/commit/4f73b638af06447bd1ee5e5513f8198ad89a27ca))
* revise levels to 3-tier system, add achievements, check-in, and connector verification ([#70](https://github.com/aibtcdev/landing-page/issues/70)) ([2c08afb](https://github.com/aibtcdev/landing-page/commit/2c08afbfec5b8782d6bdc0a46b192cc44c9ac770))

## [1.1.0](https://github.com/aibtcdev/landing-page/compare/v1.0.0...v1.1.0) (2026-02-09)


### Features

* **admin:** add genesis payout API endpoint ([#53](https://github.com/aibtcdev/landing-page/issues/53)) ([cca7065](https://github.com/aibtcdev/landing-page/commit/cca7065d3d72b39fdd0da0feee0c5a5fd7a29b09))
* Bitcoin-first refresh for landing page ([#34](https://github.com/aibtcdev/landing-page/issues/34)) ([4bb5e02](https://github.com/aibtcdev/landing-page/commit/4bb5e0224db10943e94ab9463658fdb22ac28a7a))
* challenge/response system for agent profile updates ([#59](https://github.com/aibtcdev/landing-page/issues/59)) ([e48a5da](https://github.com/aibtcdev/landing-page/commit/e48a5da0d0e09cbbd0100cd0111932b0d71a9db0))
* dual-purpose URL architecture for agents and humans ([#45](https://github.com/aibtcdev/landing-page/issues/45)) ([bd801d9](https://github.com/aibtcdev/landing-page/commit/bd801d9248540d76f86b527e6c68b49fa91f9d0b))
* **guide:** add MCP integration guide ([#54](https://github.com/aibtcdev/landing-page/issues/54)) ([a756cec](https://github.com/aibtcdev/landing-page/commit/a756cecbf7e6fd711e2a4cf0255d44165bd81b64))
* improve Zero to Agent guide UX ([#32](https://github.com/aibtcdev/landing-page/issues/32)) ([1c67f58](https://github.com/aibtcdev/landing-page/commit/1c67f58a21c477a8a41d0cbc34e72a186db554ba))
* Level/achievement system for agents ([#55](https://github.com/aibtcdev/landing-page/issues/55)) ([48ea3f9](https://github.com/aibtcdev/landing-page/commit/48ea3f929db00a15f38d92d5869f3b7b3158585d))
* make aibtc.com agent-ready ([#42](https://github.com/aibtcdev/landing-page/issues/42)) ([78b9743](https://github.com/aibtcdev/landing-page/commit/78b9743affd8a53a2b2e8639fdcc8685e890a1b8))
* **seo:** add structured data and meta tag for AI agent discovery ([#64](https://github.com/aibtcdev/landing-page/issues/64)) ([1da8e68](https://github.com/aibtcdev/landing-page/commit/1da8e68dfc31f9ee108e1f2083af1edb6079f336))
* simplify homepage with guide pages ([#50](https://github.com/aibtcdev/landing-page/issues/50)) ([19c5029](https://github.com/aibtcdev/landing-page/commit/19c50299ea7e172bfecc33e2c9ab5f49776f56d0))
* Viral claim system for agent registration rewards ([#40](https://github.com/aibtcdev/landing-page/issues/40)) ([fb5690e](https://github.com/aibtcdev/landing-page/commit/fb5690e423405c46a43f5dc5c3ece5ae06e2c066))


### Bug Fixes

* **attention:** address 15 review issues across paid attention system ([46b177f](https://github.com/aibtcdev/landing-page/commit/46b177f826a33032a8e420f3db53a6c3b212a5b7))
* **attention:** address 15 review issues across paid attention system ([#66](https://github.com/aibtcdev/landing-page/issues/66)) ([46b177f](https://github.com/aibtcdev/landing-page/commit/46b177f826a33032a8e420f3db53a6c3b212a5b7))
* **claims:** harden viral claim endpoint ([#56](https://github.com/aibtcdev/landing-page/issues/56)) ([b73781c](https://github.com/aibtcdev/landing-page/commit/b73781c83f255214e3d5f6026a99a22e66f355bf))
* **ui:** clean up navbar, align sections, redesign upgrades grid ([#61](https://github.com/aibtcdev/landing-page/issues/61)) ([d2ab23d](https://github.com/aibtcdev/landing-page/commit/d2ab23d422398d250edcc0d2885012e589d004b4))
* **ui:** improve hero and how-it-works mobile spacing ([#60](https://github.com/aibtcdev/landing-page/issues/60)) ([c8bfce6](https://github.com/aibtcdev/landing-page/commit/c8bfce6ccdfa3d03f8688ba789b3b171a206e2dc))
* **ui:** improve leaderboard mobile layout ([#57](https://github.com/aibtcdev/landing-page/issues/57)) ([9f5253e](https://github.com/aibtcdev/landing-page/commit/9f5253ecfdeed77d28ba30715ac6bde6cd9d363f))
* **ui:** remove profile editing UI and fix double title suffix ([#65](https://github.com/aibtcdev/landing-page/issues/65)) ([1ba31b3](https://github.com/aibtcdev/landing-page/commit/1ba31b36c470df032387ff737ad24d94db400331))
* **ui:** update hero copy and add leaderboard register CTA ([#58](https://github.com/aibtcdev/landing-page/issues/58)) ([d3ce05a](https://github.com/aibtcdev/landing-page/commit/d3ce05abb55697d8a22f7999084a20dd010af473))
