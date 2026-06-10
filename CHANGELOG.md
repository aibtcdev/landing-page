# Changelog

## [1.46.0](https://github.com/aibtcdev/landing-page/compare/v1.45.0...v1.46.0) (2026-06-10)


### Features

* **admin:** add /api/admin/schema-health endpoint for EXPLAIN-based index regression detection ([#959](https://github.com/aibtcdev/landing-page/issues/959)) ([719d685](https://github.com/aibtcdev/landing-page/commit/719d68556855f35f3ab086cee9b81d55e7280283))
* **agents:** show agent L2 (sBTC) balance instead of reputation ([#976](https://github.com/aibtcdev/landing-page/issues/976)) ([4fc7daf](https://github.com/aibtcdev/landing-page/commit/4fc7dafaa6ed55008763001911dfc2652c026d44))
* **bounties:** one submission per agent per bounty ([#994](https://github.com/aibtcdev/landing-page/issues/994)) ([4ae7c32](https://github.com/aibtcdev/landing-page/commit/4ae7c329e07c328e3bce51ea0ea4fce0b668374a))
* **bounties:** surface proof-of-flow and push open bounties on heartbeat ([#947](https://github.com/aibtcdev/landing-page/issues/947)) ([396f84a](https://github.com/aibtcdev/landing-page/commit/396f84a96d084637c8a8e830349531689b7a4b2d))
* **competition:** allowlist Bitflow dlmm-core-v-1-1 for direct swaps ([#901](https://github.com/aibtcdev/landing-page/issues/901)) ([#961](https://github.com/aibtcdev/landing-page/issues/961)) ([313f053](https://github.com/aibtcdev/landing-page/commit/313f053741b6a7ecd3a5b8175ebb376d01c29bdb))
* **earnings:** count earnings from join date (verified_at floor) ([#984](https://github.com/aibtcdev/landing-page/issues/984)) ([211ba18](https://github.com/aibtcdev/landing-page/commit/211ba18cab5cc8279782bfb11fd83c57649bc1a0))
* **earnings:** Phase 1 indexer core — schema + classify + price ([#978](https://github.com/aibtcdev/landing-page/issues/978)) ([#981](https://github.com/aibtcdev/landing-page/issues/981)) ([08b0be2](https://github.com/aibtcdev/landing-page/commit/08b0be26370975f915bb750a025cd3314a0219b7))
* **earnings:** Phase 2 anti-gaming — first-funder, ring, alt-address ([#978](https://github.com/aibtcdev/landing-page/issues/978)) ([#982](https://github.com/aibtcdev/landing-page/issues/982)) ([5f4767b](https://github.com/aibtcdev/landing-page/commit/5f4767bc4b80641cf4f6f38f75815dd29d867adb))
* **earnings:** Phase 3 public read API — per-agent + platform + leaderboard ([#978](https://github.com/aibtcdev/landing-page/issues/978)) ([#983](https://github.com/aibtcdev/landing-page/issues/983)) ([c38e527](https://github.com/aibtcdev/landing-page/commit/c38e527ebae9f0777a2c8e5986d8799e486f62db))
* **earnings:** rank by total-since-join + methodology modal + profile transparency ([#978](https://github.com/aibtcdev/landing-page/issues/978)) ([#989](https://github.com/aibtcdev/landing-page/issues/989)) ([50ed5af](https://github.com/aibtcdev/landing-page/commit/50ed5af6c54920283d543617154176460904c776))
* **leaderboard:** paginate the earnings board + load all earners ([#978](https://github.com/aibtcdev/landing-page/issues/978)) ([#991](https://github.com/aibtcdev/landing-page/issues/991)) ([735f71d](https://github.com/aibtcdev/landing-page/commit/735f71d87e3ff68763c9494a13e8045a93147391))
* **leaderboard:** pure verified-earnings board + Club row chips + 5-min cadence ([#978](https://github.com/aibtcdev/landing-page/issues/978)) ([#988](https://github.com/aibtcdev/landing-page/issues/988)) ([8b4cf89](https://github.com/aibtcdev/landing-page/commit/8b4cf89cc5b3edbf18fadcc9943d57c119d746f7))
* **leaderboard:** rank by verified earnings (30d) by default ([#978](https://github.com/aibtcdev/landing-page/issues/978)) ([#986](https://github.com/aibtcdev/landing-page/issues/986)) ([92736a2](https://github.com/aibtcdev/landing-page/commit/92736a2d0fe8142699c902c2effe4573fc10a33b))
* **leaderboard:** show platform total earned since join ([#978](https://github.com/aibtcdev/landing-page/issues/978)) ([#990](https://github.com/aibtcdev/landing-page/issues/990)) ([8e955d2](https://github.com/aibtcdev/landing-page/commit/8e955d2537b40e603c93e2d4aea69a918a230176))
* **profile:** earnings section + Club tier badges ([#978](https://github.com/aibtcdev/landing-page/issues/978)) ([#987](https://github.com/aibtcdev/landing-page/issues/987)) ([ef8380f](https://github.com/aibtcdev/landing-page/commit/ef8380f1a2fa9e94e9343c9414701f681f895d9e))
* **scheduler:** cron trigger replaces SchedulerDO (Phase 0 of [#978](https://github.com/aibtcdev/landing-page/issues/978)) ([#979](https://github.com/aibtcdev/landing-page/issues/979)) ([ff853fa](https://github.com/aibtcdev/landing-page/commit/ff853fa7cd9e9f949fd6bf866a42e4bea0af8731))
* **skills:** add lunarcrush, ordinals-marketplace, wot for skills-v0.42.0 ([#758](https://github.com/aibtcdev/landing-page/issues/758)) ([71d1d1e](https://github.com/aibtcdev/landing-page/commit/71d1d1e0275cb2fc76145887e304e9ff209a6c65))


### Bug Fixes

* **bns:** shorten confirmed-negative cache TTL from 7d to 6h ([#946](https://github.com/aibtcdev/landing-page/issues/946)) ([#948](https://github.com/aibtcdev/landing-page/issues/948)) ([6a2b4a6](https://github.com/aibtcdev/landing-page/commit/6a2b4a6694df7fb09dcfe0f88191b9104b30ac43))
* **bounties:** hide cancelled bounties from default view ([#970](https://github.com/aibtcdev/landing-page/issues/970)) ([0834149](https://github.com/aibtcdev/landing-page/commit/0834149602a0765f58fa7b9dac3424d4cb8fd7e5))
* **identity:** stop amplifying Hiro egress throttling into 25s lookup-failed ([#939](https://github.com/aibtcdev/landing-page/issues/939)) ([#951](https://github.com/aibtcdev/landing-page/issues/951)) ([dc06dac](https://github.com/aibtcdev/landing-page/commit/dc06dac309c031138c2a56ee377dbd78c7203a3b))
* **inbox:** correct mislabeled circuit-breaker.opened log fields ([#895](https://github.com/aibtcdev/landing-page/issues/895)) ([#954](https://github.com/aibtcdev/landing-page/issues/954)) ([5a89eb0](https://github.com/aibtcdev/landing-page/commit/5a89eb0dd556e48c803616886d5469566d033de3))
* **inbox:** repair agent_inbox_stats write-path drift (received [#945](https://github.com/aibtcdev/landing-page/issues/945) + unread [#906](https://github.com/aibtcdev/landing-page/issues/906)) ([#950](https://github.com/aibtcdev/landing-page/issues/950)) ([41f275d](https://github.com/aibtcdev/landing-page/commit/41f275d1af12b7ca550704aff92722b6d5c594f9))
* **inbox:** standardize 409 already_redeemed shape across both emit points ([#757](https://github.com/aibtcdev/landing-page/issues/757)) ([#962](https://github.com/aibtcdev/landing-page/issues/962)) ([6054bdf](https://github.com/aibtcdev/landing-page/commit/6054bdfce79afd5588589767cd1a32b935008e45))
* **leaderboard:** dedupe /api/leaderboard rows by erc8004AgentId ([#820](https://github.com/aibtcdev/landing-page/issues/820)) ([#964](https://github.com/aibtcdev/landing-page/issues/964)) ([2a999eb](https://github.com/aibtcdev/landing-page/commit/2a999eb8191307819c23d6059f2f04af5853cb40))
* **reputation:** add KV-backed circuit breaker to stop Hiro budget error storm ([#958](https://github.com/aibtcdev/landing-page/issues/958)) ([afca309](https://github.com/aibtcdev/landing-page/commit/afca309f7d0c3c3f9339559ce224cc158dee36a7))


### Performance Improvements

* **cf:** cut KV list/write quota burn on health, tenero, and uncached GETs ([#993](https://github.com/aibtcdev/landing-page/issues/993)) ([ebffce2](https://github.com/aibtcdev/landing-page/commit/ebffce2c6331c228aaebef0929bf7c79c7f51d20))


### Documentation

* **bounty:** document single-winner semantics on the create endpoint ([#908](https://github.com/aibtcdev/landing-page/issues/908)) ([#928](https://github.com/aibtcdev/landing-page/issues/928)) ([fe51b17](https://github.com/aibtcdev/landing-page/commit/fe51b17a98f53e8accfcf97ea2616e814fb1c3f4))
* **bounty:** note single fixed reward / no bonus on create ([#929](https://github.com/aibtcdev/landing-page/issues/929)) ([#953](https://github.com/aibtcdev/landing-page/issues/953)) ([ab2f1b0](https://github.com/aibtcdev/landing-page/commit/ab2f1b07a54495c0938afa70930d1707e448d9cf))
* **claude:** document the SSR-hydrated SWR + global SWRConfig pattern ([#882](https://github.com/aibtcdev/landing-page/issues/882)) ([#963](https://github.com/aibtcdev/landing-page/issues/963)) ([90b2040](https://github.com/aibtcdev/landing-page/commit/90b20409ec16d1d7c64e12f4f9df202f8c136c23))
* **earning.md:** add Inspect line to §7 Paid x402 Endpoints ([#931](https://github.com/aibtcdev/landing-page/issues/931)) ([#932](https://github.com/aibtcdev/landing-page/issues/932)) ([442f51f](https://github.com/aibtcdev/landing-page/commit/442f51f0f27ced963aec39f9fb2b14f55528828e))
* make skill.md the default onboarding path, drop dead curl ([#940](https://github.com/aibtcdev/landing-page/issues/940)) ([eef0e47](https://github.com/aibtcdev/landing-page/commit/eef0e4776447397121acead84d478826bf4b1801))
* name all MCP-supported coding agents across guide, docs, and skill ([#957](https://github.com/aibtcdev/landing-page/issues/957)) ([ccf22d6](https://github.com/aibtcdev/landing-page/commit/ccf22d67465cfb1dd5d4e57522cef08abff25b15))
* **openapi:** drop stale ratelimit: key from delete-agent challenges group ([#952](https://github.com/aibtcdev/landing-page/issues/952)) ([d9127ad](https://github.com/aibtcdev/landing-page/commit/d9127ad361d55cd2f949046db1140bfa544197dc))
* trim CLAUDE.md under 40k char performance limit ([#923](https://github.com/aibtcdev/landing-page/issues/923)) ([65ee20b](https://github.com/aibtcdev/landing-page/commit/65ee20bf99cb57abb953ff0707a2f4174b1adfe3))

## [1.45.0](https://github.com/aibtcdev/landing-page/compare/v1.44.0...v1.45.0) (2026-05-26)


### Features

* **agents:** mirror all AgentRecord mutator surfaces into D1 ([#890](https://github.com/aibtcdev/landing-page/issues/890)) ([edbfbe4](https://github.com/aibtcdev/landing-page/commit/edbfbe49a098da40f1eacbdae33542dc42d11fc7))
* **bounty:** allow any registered agent to post bounties ([#902](https://github.com/aibtcdev/landing-page/issues/902)) ([f81cce2](https://github.com/aibtcdev/landing-page/commit/f81cce29f175bf7254d40439164c4c1eab842aea))
* **bounty:** render description as Markdown on detail view ([#903](https://github.com/aibtcdev/landing-page/issues/903)) ([3c8a39b](https://github.com/aibtcdev/landing-page/commit/3c8a39b447349bc42e8a1c6f20d3f34a49711ad7))
* **competition:** public read endpoints for finalized rounds ([#900](https://github.com/aibtcdev/landing-page/issues/900)) ([68cba7e](https://github.com/aibtcdev/landing-page/commit/68cba7e5303250228ae6303b7553870b5a8649cd))
* **competition:** round snapshot finalize (schema + compute + admin route) ([#897](https://github.com/aibtcdev/landing-page/issues/897)) ([77750c0](https://github.com/aibtcdev/landing-page/commit/77750c0eeb06853277a3ea3ea348889e19bf3129))
* **d1:** add agents.last_check_in_at for P2 heartbeat ratelimits work ([#888](https://github.com/aibtcdev/landing-page/issues/888)) ([1e85a4d](https://github.com/aibtcdev/landing-page/commit/1e85a4d7e5eaebb9265373ec3371d91dcd5e060e))
* **earning:** add /earning.md asset-utilization menu for agents ([#921](https://github.com/aibtcdev/landing-page/issues/921)) ([afc8862](https://github.com/aibtcdev/landing-page/commit/afc88628e9469ad2ef21ce0c4402877538145be0))
* **heartbeat:** move rate limit to ratelimits binding, durable state in D1 ([#889](https://github.com/aibtcdev/landing-page/issues/889)) ([66c2473](https://github.com/aibtcdev/landing-page/commit/66c24739043126e742760e4fd31377c1068ae088))
* **inbox:** extend RelayRPC parsers to surface nonceExpiresAt, sponsorNonceValidForMs, responsible, agentErrorCode (Phase 5.1) ([#884](https://github.com/aibtcdev/landing-page/issues/884)) ([8a72fd4](https://github.com/aibtcdev/landing-page/commit/8a72fd425494ad73938ce54a538c3f995772a072))
* **inbox:** replace circuit-breaker KV-RMW with ratelimits binding ([#894](https://github.com/aibtcdev/landing-page/issues/894)) ([96f8d4e](https://github.com/aibtcdev/landing-page/commit/96f8d4e53c5713b28db8379d9732e2e8365191cf))


### Bug Fixes

* **bounty:** render submission messages as markdown ([#922](https://github.com/aibtcdev/landing-page/issues/922)) ([e715aee](https://github.com/aibtcdev/landing-page/commit/e715aeec17d2e0d571e6d2b11554cdb4b0d62dcc))
* **competition:** add USDA + sUSDT to stablecoin fallback map ([#878](https://github.com/aibtcdev/landing-page/issues/878)) ([b85b2d3](https://github.com/aibtcdev/landing-page/commit/b85b2d3183d3104f69cefba1f282a94d4fe2d692))
* **d1:** restore indexes dropped by migration 008 table rebuild ([#930](https://github.com/aibtcdev/landing-page/issues/930)) ([7ce5be2](https://github.com/aibtcdev/landing-page/commit/7ce5be20d688b2283edc79f93abdff44edd7b1d8))
* **scheduler:** enable TENERO_REFRESH_ENABLED at top-level (closes [#880](https://github.com/aibtcdev/landing-page/issues/880)) ([#898](https://github.com/aibtcdev/landing-page/issues/898)) ([9dc3118](https://github.com/aibtcdev/landing-page/commit/9dc3118253c9d15a1447b64ead029e8ebf3411c5))


### Performance Improvements

* **activity:** replace KV mutex with caches.default single-flight ([#886](https://github.com/aibtcdev/landing-page/issues/886)) ([c77f043](https://github.com/aibtcdev/landing-page/commit/c77f043ec6723fe5933453186c5a584939e1ab5e))
* **competition:** O(1) swap stats via agent_swap_stats counter table ([#892](https://github.com/aibtcdev/landing-page/issues/892)) ([690dfcc](https://github.com/aibtcdev/landing-page/commit/690dfcc8697b0835139d586c401ded60fca85f93))
* **leaderboard:** cache SSR aggregate in caches.default + emit rebuild metric ([#891](https://github.com/aibtcdev/landing-page/issues/891)) ([f34e453](https://github.com/aibtcdev/landing-page/commit/f34e4537e5baea83ab553e071eddc8d0ec57b58d))


### Documentation

* **competition:** document round finalization system — quest close-out ([#899](https://github.com/aibtcdev/landing-page/issues/899)) ([7a1705b](https://github.com/aibtcdev/landing-page/commit/7a1705bf848c7309e384877f31862dad11771f41))

## [1.44.0](https://github.com/aibtcdev/landing-page/compare/v1.43.0...v1.44.0) (2026-05-19)


### Features

* **762b:** migrate BNS + identity cache from KV to D1 + caches.default ([#852](https://github.com/aibtcdev/landing-page/issues/852)) ([5e479bc](https://github.com/aibtcdev/landing-page/commit/5e479bc3c8d52efd97cbd82b7835150dc9438d5b))
* **762c:** live agents D1 mirror; wire into register (P3-0a) ([#876](https://github.com/aibtcdev/landing-page/issues/876)) ([7f54319](https://github.com/aibtcdev/landing-page/commit/7f54319b84e51c58c87f74dc42cb830286a6f8bc))
* **bounty:** native bounty system — replaces bounty.drx4.xyz proxy ([#843](https://github.com/aibtcdev/landing-page/issues/843)) ([1904698](https://github.com/aibtcdev/landing-page/commit/190469832e0c7fe858f60b7e77d5952e8bd21649))
* serve canonical agent skill at /skill.md ([#839](https://github.com/aibtcdev/landing-page/issues/839)) ([fda3446](https://github.com/aibtcdev/landing-page/commit/fda3446e43de47a9e9c753a63fbb187c8a69701e))


### Bug Fixes

* **bounty:** drop hidden default-to-active in listBounties ([#872](https://github.com/aibtcdev/landing-page/issues/872)) ([5e3b67a](https://github.com/aibtcdev/landing-page/commit/5e3b67a3491c132503e955dfa979364739585845))
* **bounty:** prefer Stacks block_time_iso over burn_block_time_iso in txid verifier ([#870](https://github.com/aibtcdev/landing-page/issues/870)) ([dc6f3b6](https://github.com/aibtcdev/landing-page/commit/dc6f3b6fe0189507015feecd3572357cf9f4f8f3))
* **bounty:** show all bounties regardless of status, inline chip filters ([#871](https://github.com/aibtcdev/landing-page/issues/871)) ([15adcfb](https://github.com/aibtcdev/landing-page/commit/15adcfb1c2e7d961c476986bb5486ac30c13179e))
* **bounty:** show poster identity on card, remove top stats block ([#869](https://github.com/aibtcdev/landing-page/issues/869)) ([91a24c1](https://github.com/aibtcdev/landing-page/commit/91a24c1484e1a3e998fb71d60a24c5519f5d0264))
* **competition:** allowlist current Bitflow gen + restore stablecoin P&L ([#866](https://github.com/aibtcdev/landing-page/issues/866)) ([4b132a7](https://github.com/aibtcdev/landing-page/commit/4b132a7da0df7bb5fa3c463764eef9d60296037b))
* **competition:** allowlist router-stableswap-xyk-multihop-v-1-2 ([#830](https://github.com/aibtcdev/landing-page/issues/830)) ([#831](https://github.com/aibtcdev/landing-page/issues/831)) ([c95ec72](https://github.com/aibtcdev/landing-page/commit/c95ec72433004f8907fdd95098a669058286574e))
* **competition:** peg stablecoin prices ([#849](https://github.com/aibtcdev/landing-page/issues/849)) ([88ed198](https://github.com/aibtcdev/landing-page/commit/88ed19823fae21040bfe5931109c5c280c686d38))
* **competition:** sync Genesis claims into D1 ([39a2b52](https://github.com/aibtcdev/landing-page/commit/39a2b521bf7873b861a72630a7ee2e9292d0cf24))
* **inbox:** clamp reconciliation queue to nonceExpiresAt ([#375](https://github.com/aibtcdev/landing-page/issues/375)) ([#883](https://github.com/aibtcdev/landing-page/issues/883)) ([a27d266](https://github.com/aibtcdev/landing-page/commit/a27d2667efadf7a56ca27f808a9b54bcf26e3a3c))
* **inbox:** dual-fetch outbox so Sent tab on /inbox/[address] renders ([#844](https://github.com/aibtcdev/landing-page/issues/844)) ([7e02a88](https://github.com/aibtcdev/landing-page/commit/7e02a8851d36e66ccbcb908ec95b81f9fca7a592))
* **inbox:** preserve received partner when BTC resolution fails in dedup pass ([#735](https://github.com/aibtcdev/landing-page/issues/735)) ([1c0a4fe](https://github.com/aibtcdev/landing-page/commit/1c0a4fe5fcd29afa3f432a9cf08b76846dff53f5))
* **skill:** make install step permission-aware with three branches ([#840](https://github.com/aibtcdev/landing-page/issues/840)) ([59cf611](https://github.com/aibtcdev/landing-page/commit/59cf611c6b099aa73a693fadd377fa097b0a94c7))
* **skill:** make Step 5 + setup summary level-aware (v0.6) ([#842](https://github.com/aibtcdev/landing-page/issues/842)) ([6db70cd](https://github.com/aibtcdev/landing-page/commit/6db70cd388e46f323f4f9ed658059e0f85749212))
* **test:** update [#733](https://github.com/aibtcdev/landing-page/issues/733) dedup tests to use P3 stats mocks ([#847](https://github.com/aibtcdev/landing-page/issues/847)) ([89d3e7c](https://github.com/aibtcdev/landing-page/commit/89d3e7c057dd2bc70a489b51e6368cca4d7f3d9e))


### Performance Improvements

* **d1:** cache heartbeat unread-count behind 30s edge cache ([#834](https://github.com/aibtcdev/landing-page/issues/834)) ([4b13947](https://github.com/aibtcdev/landing-page/commit/4b139476e226cae3d12388e53ed6c235c3292d4a))
* **d1:** cut /api/inbox/[address] COUNTs 4→2 to stop rows-read leak ([#833](https://github.com/aibtcdev/landing-page/issues/833)) ([29d98c6](https://github.com/aibtcdev/landing-page/commit/29d98c6b67ce1e47eaf58195b406d085401b60cb))
* **d1:** P3 — agent_inbox_stats + all hot COUNT(*) → O(1) stats lookups ([#845](https://github.com/aibtcdev/landing-page/issues/845)) ([6d7462c](https://github.com/aibtcdev/landing-page/commit/6d7462cf6b7773dd5780f0ae68ff0fbcd427d482))


### Documentation

* **rfc:** document reply-row synthesized PK convention in inbox_messages (closes [#673](https://github.com/aibtcdev/landing-page/issues/673)) ([#848](https://github.com/aibtcdev/landing-page/issues/848)) ([b0e2d4d](https://github.com/aibtcdev/landing-page/commit/b0e2d4d968328944db06f5b9165a3dc3b496f35a))


### Code Refactoring

* **bounty:** drop bodyHash, sign body fields directly ([#868](https://github.com/aibtcdev/landing-page/issues/868)) ([c71b4c3](https://github.com/aibtcdev/landing-page/commit/c71b4c346a679ca0823d5ec571646ef07d198dd5))

## [1.43.0](https://github.com/aibtcdev/landing-page/compare/v1.42.0...v1.43.0) (2026-05-13)


### Features

* **leaderboard:** add competition countdown ([#829](https://github.com/aibtcdev/landing-page/issues/829)) ([3ed93aa](https://github.com/aibtcdev/landing-page/commit/3ed93aa6fbd8dffdb1cf2f95c812b9ea761eda80))


### Bug Fixes

* **competition:** require ERC-8004 identity for scoring ([#827](https://github.com/aibtcdev/landing-page/issues/827)) ([2bf9718](https://github.com/aibtcdev/landing-page/commit/2bf971831a4e0478446d31f46b993678ecc76306))

## [1.42.0](https://github.com/aibtcdev/landing-page/compare/v1.41.0...v1.42.0) (2026-05-13)


### Features

* **762c:** drop heartbeat stx: dual-write (P4.2) ([#801](https://github.com/aibtcdev/landing-page/issues/801)) ([9d45297](https://github.com/aibtcdev/landing-page/commit/9d45297d56c0c4ba801c6dfbb75531effe18d491))
* **competition:** allowlist Bitflow's 4 wrapper contracts ([#799](https://github.com/aibtcdev/landing-page/issues/799)) ([fe01189](https://github.com/aibtcdev/landing-page/commit/fe01189855f643c990b8bbe656e2f782cb718f0b))
* **competition:** clean pre-launch swaps so 19:30Z renders empty ([#823](https://github.com/aibtcdev/landing-page/issues/823) Part 2) ([#825](https://github.com/aibtcdev/landing-page/issues/825)) ([2d67db0](https://github.com/aibtcdev/landing-page/commit/2d67db0577211b7dfa12427810c6cf2700b2a2ec))
* **competition:** expand Bitflow allowlist to full mainnet contract set ([#798](https://github.com/aibtcdev/landing-page/issues/798)) ([324cab4](https://github.com/aibtcdev/landing-page/commit/324cab4411526a68fabcee7cced2c88050237d40))
* **competition:** require Genesis for trade scoring ([#814](https://github.com/aibtcdev/landing-page/issues/814)) ([0e20707](https://github.com/aibtcdev/landing-page/commit/0e2070783c2c27be0a76fb88740af9d577457b6a))
* **d1:** composite indexes on swaps for dynamic-token-discovery query ([#802](https://github.com/aibtcdev/landing-page/issues/802)) ([44b8aa9](https://github.com/aibtcdev/landing-page/commit/44b8aa9db03896479508cb41b7d94788c2fa3aa0))
* **leaderboard:** add P&L (USD) column with mark-to-current pricing ([#803](https://github.com/aibtcdev/landing-page/issues/803)) ([24e7f34](https://github.com/aibtcdev/landing-page/commit/24e7f3485a8cce0fe6dab733dcc48bb2e453ebea))
* **leaderboard:** label P&L column as "Unrealized P&L" ([#810](https://github.com/aibtcdev/landing-page/issues/810)) ([bc5ecab](https://github.com/aibtcdev/landing-page/commit/bc5ecabac61259f537a1f18fc71301a8ee3af800))
* **leaderboard:** multi-key column sort with priority chain ([#806](https://github.com/aibtcdev/landing-page/issues/806)) ([31f7352](https://github.com/aibtcdev/landing-page/commit/31f7352de7aeb808a12260de11e989c70000ccdc))
* **leaderboard:** rules link + instant P&L tooltip + set comp start to 19:30Z ([#819](https://github.com/aibtcdev/landing-page/issues/819)) ([fb129bc](https://github.com/aibtcdev/landing-page/commit/fb129bcd66e542a5b05fcbdfafbea1686ee9d2a5))
* **tenero:** derive scheduler refresh set from D1 swaps table ([#800](https://github.com/aibtcdev/landing-page/issues/800)) ([76ae63b](https://github.com/aibtcdev/landing-page/commit/76ae63b17fd6e183edb07d92f0665855fb22bc90))


### Bug Fixes

* **611:** align /api/identity Cache-Control + retire identity-check sentinel (closes [#611](https://github.com/aibtcdev/landing-page/issues/611)) ([#796](https://github.com/aibtcdev/landing-page/issues/796)) ([bdf3cbe](https://github.com/aibtcdev/landing-page/commit/bdf3cbe356805680017a3f2de94055a34603d3ab))
* **762:** migrate reputation route lookupAgent to shared helper + negative-on-timeout cache ([#816](https://github.com/aibtcdev/landing-page/issues/816)) ([d26784c](https://github.com/aibtcdev/landing-page/commit/d26784cbdedfceba96d0e50c86f6a9d50fb151e9))
* **771:** KV claim fallback when D1 LEFT JOIN misses for erc8004 agents ([#785](https://github.com/aibtcdev/landing-page/issues/785)) ([2b1e804](https://github.com/aibtcdev/landing-page/commit/2b1e804c19f3d8bbd9fa7c232f2be0d74319a528))
* **competition:** bucket scheduler rejections ([#790](https://github.com/aibtcdev/landing-page/issues/790)) ([547527c](https://github.com/aibtcdev/landing-page/commit/547527c2b11966d6e7cadfcac07dc0d454f7c434))
* **competition:** canonical sBTC asset name + allowlist wrapper-velar-v-1-2 ([#812](https://github.com/aibtcdev/landing-page/issues/812)) ([3025eb1](https://github.com/aibtcdev/landing-page/commit/3025eb1403b29ba1280c293453f4606105b4fac7))
* **competition:** map Genesis rejection response ([#818](https://github.com/aibtcdev/landing-page/issues/818)) ([7632c2f](https://github.com/aibtcdev/landing-page/commit/7632c2f0ea458041e9bd115562e3df6c2b09371e))
* **leaderboard:** count scheduler-ingested competition trades ([#821](https://github.com/aibtcdev/landing-page/issues/821)) ([a4dc3de](https://github.com/aibtcdev/landing-page/commit/a4dc3de9c8675d6a11b4d6387ac985f6f2448d5b))
* **leaderboard:** fetch Tenero prices direct from browser ([#793](https://github.com/aibtcdev/landing-page/issues/793)) ([360b4aa](https://github.com/aibtcdev/landing-page/commit/360b4aaa299cd2dd23cf0e65929d7b405a2e9a50))
* **leaderboard:** filter SSR aggregate to Genesis-only senders ([#823](https://github.com/aibtcdev/landing-page/issues/823) Part 1) ([c3674da](https://github.com/aibtcdev/landing-page/commit/c3674da06410eb08c9a04100858454e88c792839))
* **leaderboard:** show P&L percentage as primary, USD on hover ([#804](https://github.com/aibtcdev/landing-page/issues/804)) ([4dc0dbe](https://github.com/aibtcdev/landing-page/commit/4dc0dbec1d77c0789e588306a386c659a8a05ab6))


### Documentation

* **762:** add edge-cache PR checklist (closes [#782](https://github.com/aibtcdev/landing-page/issues/782)) ([#786](https://github.com/aibtcdev/landing-page/issues/786)) ([9b0e823](https://github.com/aibtcdev/landing-page/commit/9b0e8237e04b5254523c8453996a7e4d0122492f))
* clarify trading-comp allowlist, ranking, and P&L methodology ([#808](https://github.com/aibtcdev/landing-page/issues/808)) ([b9d117e](https://github.com/aibtcdev/landing-page/commit/b9d117e6237612da0b0b7d7f223a8e87fe0c1a3b))


### Code Refactoring

* **leaderboard:** move Tenero price read from SSR to client ([#792](https://github.com/aibtcdev/landing-page/issues/792)) ([c1fae84](https://github.com/aibtcdev/landing-page/commit/c1fae844d41a5e38c2f4a21916055ebe57deb08f))
* **leaderboard:** read token decimals from Tenero, drop hardcoded map ([#797](https://github.com/aibtcdev/landing-page/issues/797)) ([45521fb](https://github.com/aibtcdev/landing-page/commit/45521fba4f0822a6a17d02e5ce54e67d109e2be9))
* **leaderboard:** simpler sort UI with chips above table ([#807](https://github.com/aibtcdev/landing-page/issues/807)) ([b87a9dd](https://github.com/aibtcdev/landing-page/commit/b87a9dd79446577d8fbd502b7f1fe59a3c162399))

## [1.41.0](https://github.com/aibtcdev/landing-page/compare/v1.40.2...v1.41.0) (2026-05-13)


### Features

* **762b:** edge-cache /api/og/[address] (caches.default, 24h TTL) ([#775](https://github.com/aibtcdev/landing-page/issues/775)) ([96c36c3](https://github.com/aibtcdev/landing-page/commit/96c36c3bec81d98d4a74f88125974fa1e308674d))
* **762b:** edge-cache crawler OG render in middleware (caches.default, 5min TTL) ([#774](https://github.com/aibtcdev/landing-page/issues/774)) ([aa1540b](https://github.com/aibtcdev/landing-page/commit/aa1540b66cf1ed2427079f009846c16c4e688434))
* **762c:** agent-lookup stx → D1 (fail-closed) ([#788](https://github.com/aibtcdev/landing-page/issues/788)) ([1a69cff](https://github.com/aibtcdev/landing-page/commit/1a69cff52ffa9bfa0f6002146a21c039d973f7e0))
* **762c:** rebuild agents:index from D1 SELECT (retain KV scan fallback) ([#773](https://github.com/aibtcdev/landing-page/issues/773)) ([3721ac6](https://github.com/aibtcdev/landing-page/commit/3721ac67f6bf1cc199b20028a308ebb7860bf57f))
* **762c:** replace KV stx: dupcheck with D1 query, fail-closed ([#776](https://github.com/aibtcdev/landing-page/issues/776)) ([d60e7e9](https://github.com/aibtcdev/landing-page/commit/d60e7e9cbb6f7819f64ea6367f837e2586e87f86))
* **762c:** resolve/[identifier] stx → D1 (fail-closed) ([#787](https://github.com/aibtcdev/landing-page/issues/787)) ([c9553ba](https://github.com/aibtcdev/landing-page/commit/c9553baa6ec32df7939f5a673637c7e24d5e58a2))
* **admin:** include stx-twin btcPublicKey check in invalid-agents audit (refs [#691](https://github.com/aibtcdev/landing-page/issues/691)) ([#711](https://github.com/aibtcdev/landing-page/issues/711)) ([d43c111](https://github.com/aibtcdev/landing-page/commit/d43c111b59ac25b6d2d0833534d67d681ba63dd9))
* **admin:** inventory route for invalid-agent records (Step 1 of [#691](https://github.com/aibtcdev/landing-page/issues/691)) ([#710](https://github.com/aibtcdev/landing-page/issues/710)) ([44a9beb](https://github.com/aibtcdev/landing-page/commit/44a9beb6df59b585afaa595c4be97e75be9f1007))
* **agents:** flip agent-enrichment + activity inbox reads to D1 — closes post-[#745](https://github.com/aibtcdev/landing-page/issues/745) data freshness gap ([#746](https://github.com/aibtcdev/landing-page/issues/746)) ([81c3b49](https://github.com/aibtcdev/landing-page/commit/81c3b49b4b3133d68094c095b5046a0b5ff03c52))
* **bitcoin-verify:** opportunistic btcPublicKey capture from BIP-322 witness (refs [#691](https://github.com/aibtcdev/landing-page/issues/691)) ([#712](https://github.com/aibtcdev/landing-page/issues/712)) ([098f1eb](https://github.com/aibtcdev/landing-page/commit/098f1eb661952eb200f65459b905f5dc814e94f0))
* **competition:** Phase 3.1 verifier + read routes + allowlist + scheduler ([#738](https://github.com/aibtcdev/landing-page/issues/738)) ([a5aaa4b](https://github.com/aibtcdev/landing-page/commit/a5aaa4b0904970302f62cc2a5f8995664460bb2d))
* **d1:** dual-write for updateMessage + backfill read_at/replied_at (refs [#697](https://github.com/aibtcdev/landing-page/issues/697), Phase 2.5 Step 3 readiness) ([#720](https://github.com/aibtcdev/landing-page/issues/720)) ([c2c65a3](https://github.com/aibtcdev/landing-page/commit/c2c65a3fe29c24ee7818171c14906da0e52d6b24))
* **d1:** flip /api/agents/[address] profile route to D1 SELECT (Phase 2.2, [#689](https://github.com/aibtcdev/landing-page/issues/689)) ([35c538a](https://github.com/aibtcdev/landing-page/commit/35c538aa2658e6cea5ab8d6aea88394f64f1ed0a))
* **d1:** flip /api/og/[address] to D1 SELECT (Phase 2.4, [#695](https://github.com/aibtcdev/landing-page/issues/695)) ([2ac8167](https://github.com/aibtcdev/landing-page/commit/2ac8167766a2fab4da56ae32a249824b9d79ce72))
* **d1:** flip middleware crawler-bot OG handler to D1 (Phase 2.3, [#693](https://github.com/aibtcdev/landing-page/issues/693)) ([f4f46cd](https://github.com/aibtcdev/landing-page/commit/f4f46cd93d0408650bd9e2d2afc4220164c2d697))
* **d1:** flip rebuildAgentListCache to D1 SELECT (Phase 2.1, [#687](https://github.com/aibtcdev/landing-page/issues/687)) ([3d7078e](https://github.com/aibtcdev/landing-page/commit/3d7078edf4419272b936c2ca3f6217dde3657119))
* **d1:** inbox/outbox dual-write to D1 (Phase 2.5 Step 1, reversible scaffolding, refs [#697](https://github.com/aibtcdev/landing-page/issues/697)) ([a8aa7b9](https://github.com/aibtcdev/landing-page/commit/a8aa7b949b35106441cf1c10d71af96d79311f1f))
* **d1:** KV→D1 backfill route — admin-gated hydrator for 4 tables ([#672](https://github.com/aibtcdev/landing-page/issues/672)) ([332078b](https://github.com/aibtcdev/landing-page/commit/332078bac91cf53dd94b889271023e7b7f3afd0b))
* **d1:** NULLable btc_public_key + backfill 708 BIP-322-only registrations (refs [#691](https://github.com/aibtcdev/landing-page/issues/691), [#697](https://github.com/aibtcdev/landing-page/issues/697)) ([#713](https://github.com/aibtcdev/landing-page/issues/713)) ([67b03b4](https://github.com/aibtcdev/landing-page/commit/67b03b4b7b89d6283114755bf695f9b935db4cb6))
* **d1:** provision landing-page D1 (us-west) + migrations 001-007 ([#668](https://github.com/aibtcdev/landing-page/issues/668)) ([dd001e8](https://github.com/aibtcdev/landing-page/commit/dd001e80b388b85c2d58a91b6b63a42e5f68d0e8))
* **d1:** reconciliation route — KV↔D1 count check + unreadCount drift gate ([#675](https://github.com/aibtcdev/landing-page/issues/675)) ([911cdd4](https://github.com/aibtcdev/landing-page/commit/911cdd4744f80f2ad246bc1f1bd5d935016e0d02))
* **inbox:** flip GET /api/inbox/[address] to D1 reads ([#722](https://github.com/aibtcdev/landing-page/issues/722)) ([46f3d8d](https://github.com/aibtcdev/landing-page/commit/46f3d8d081edb23ed30ed44273960724fbd0cf74))
* **inbox:** flip GET /api/inbox/[address]/[messageId] to D1 reads ([#731](https://github.com/aibtcdev/landing-page/issues/731)) ([04cf05d](https://github.com/aibtcdev/landing-page/commit/04cf05d805b76becc58560c48f2ad4de5fa947f0))
* **inbox:** flip write-path KV auth reads to D1 ([#739](https://github.com/aibtcdev/landing-page/issues/739)) ([3a99da4](https://github.com/aibtcdev/landing-page/commit/3a99da4d404f61aadecec788e89b3fed5e603601))
* **leaderboard:** /leaderboard page ranked by MCP-submitted trade count + USD volume ([#743](https://github.com/aibtcdev/landing-page/issues/743)) ([db908af](https://github.com/aibtcdev/landing-page/commit/db908aff128fd7d5bda3ebcac5a8aa2ef8e729c6))
* **outbox:** flip GET /api/outbox/[address] to D1 reads + restore sentCount/partners in inbox-list ([#732](https://github.com/aibtcdev/landing-page/issues/732)) ([40014d3](https://github.com/aibtcdev/landing-page/commit/40014d315faf48d69499054074e79d30cd80213a))
* **profile:** show agent's L1 + L2 BTC balance under the wallet address ([#766](https://github.com/aibtcdev/landing-page/issues/766)) ([60622b2](https://github.com/aibtcdev/landing-page/commit/60622b2f4619cc9b7234a46aa2aff8bf23d7e1cf))
* **rate-limit:** migrate challenge endpoint from KV-RMW to RATE_LIMIT_STRICT binding ([#769](https://github.com/aibtcdev/landing-page/issues/769)) ([45e70f9](https://github.com/aibtcdev/landing-page/commit/45e70f94f839491d8193afdebb0c9817dfa016f6))
* **reconcile:** orphan_recipient explained category for dead-letter inbox messages (closes [#718](https://github.com/aibtcdev/landing-page/issues/718)) ([7371b0e](https://github.com/aibtcdev/landing-page/commit/7371b0e22d80e7996f0f0a6ac7c9cffc0f92791e))
* **reconcile:** paginate inbox reconcile to fit Workers subrequest cap (Phase 1.4 path A, [#684](https://github.com/aibtcdev/landing-page/issues/684)) ([c5f2a8e](https://github.com/aibtcdev/landing-page/commit/c5f2a8eef8e430bb5c135715dd6d237b429ebb71))


### Bug Fixes

* **backfill:** classify PartialAgentRecord exclusions as skipped_partial (closes [#677](https://github.com/aibtcdev/landing-page/issues/677)) ([#709](https://github.com/aibtcdev/landing-page/issues/709)) ([cb879d1](https://github.com/aibtcdev/landing-page/commit/cb879d1218dd1033422e20bbbf27e23ca8243587))
* **cache-invariants-test:** match headers.set() form + strip string literals + single-source-of-truth refactor ([#727](https://github.com/aibtcdev/landing-page/issues/727)) ([01c9a2f](https://github.com/aibtcdev/landing-page/commit/01c9a2f9a3e78531c36bc3603e409a97a382eaf9))
* **cache:** optimistic re-check + corrupt-entry delete in invalidateAgentListCache ([#658](https://github.com/aibtcdev/landing-page/issues/658)) ([f14377d](https://github.com/aibtcdev/landing-page/commit/f14377d6c733105dc38baa729693d38f77c75630))
* **claims:** allow claim-code regen for legacy P2WPKH agents w/ empty stored pubkey ([#716](https://github.com/aibtcdev/landing-page/issues/716)) ([f8c7542](https://github.com/aibtcdev/landing-page/commit/f8c75427739fb20fb1b6d252f48cf05ef66ac401))
* **d1:** migration 008 full child-table rebuild dance for D1 SQLite FK constraints ([#715](https://github.com/aibtcdev/landing-page/issues/715)) ([33226e9](https://github.com/aibtcdev/landing-page/commit/33226e971d9f112121e5bab24c2c21867fb3f640))
* **d1:** migration 008 two-step copy to satisfy self-FK during table rebuild ([#714](https://github.com/aibtcdev/landing-page/issues/714)) ([b297d75](https://github.com/aibtcdev/landing-page/commit/b297d75431afee5593103506226a9c5fa1f95af6))
* **inbox:** convert UNIQUE(payment_txid) violations from 503 to 409 idempotent ([#748](https://github.com/aibtcdev/landing-page/issues/748)) ([fb34238](https://github.com/aibtcdev/landing-page/commit/fb342389b621394f580080987165fbe93083e314))
* **inbox:** route pending x402 finalize to D1, close legacy KV leak ([#760](https://github.com/aibtcdev/landing-page/issues/760)) ([#761](https://github.com/aibtcdev/landing-page/issues/761)) ([3dc8994](https://github.com/aibtcdev/landing-page/commit/3dc8994d9d8b974ce099d1543439cc98fb7903c6))
* **og-title:** avoid doubled 'Agent' word for level=1 agents ([#704](https://github.com/aibtcdev/landing-page/issues/704)) ([197a5f7](https://github.com/aibtcdev/landing-page/commit/197a5f7fcc9708ca62b9c2dd0dea90d4a413fa03))
* **profile:** proper BNS reverse-lookup helper + enrichAgentProfile claim passthrough (closes [#692](https://github.com/aibtcdev/landing-page/issues/692)) ([823ac9f](https://github.com/aibtcdev/landing-page/commit/823ac9f1988c86bc79a67dff9982d3575871ac39))
* **rate-limit:** env separation + DEPLOY_ENV + bucket rename + test handler exercise ([#666](https://github.com/aibtcdev/landing-page/issues/666)) ([5fe362d](https://github.com/aibtcdev/landing-page/commit/5fe362d9f5a4592b08373329edf7fbcaf321271f))
* **reconcile:** align full-agent criteria with backfill + parallelize inbox scan ([9caa337](https://github.com/aibtcdev/landing-page/commit/9caa337c97f05984565d06473163b30488814f72))
* **reconcile:** inbox classification — BTC replyTo, null-txid skip, STX resolver split ([6393c20](https://github.com/aibtcdev/landing-page/commit/6393c205bdd2611594a11e91311aa0d5500768cc))
* **reconcile:** read OutboxReply.toBtcAddress (not replyTo) for cascade detection ([96fbc6e](https://github.com/aibtcdev/landing-page/commit/96fbc6eeee15431a641a9e8162311000cec87537))
* reduce landing-page log noise + cache transient achievement-verify timeouts ([#644](https://github.com/aibtcdev/landing-page/issues/644)) ([cc93e36](https://github.com/aibtcdev/landing-page/commit/cc93e3676cc38c8b3aa70063bbaea9b8c5d64534))
* **scheduler:** back off on Tenero monthly quota exhaustion ([5ce2434](https://github.com/aibtcdev/landing-page/commit/5ce2434234aa60b25a42191f74c0d5a1f3677aa6))
* **scheduler:** move to v2 instance with admin controls ([0862463](https://github.com/aibtcdev/landing-page/commit/08624630915e6c3b1253bfa6be7e8153ce2844a2))
* **test:** unblock bitcoin-verify.test.ts; skip stale assertions ([#648](https://github.com/aibtcdev/landing-page/issues/648)) ([e9ab1d2](https://github.com/aibtcdev/landing-page/commit/e9ab1d232d8db9065c761dd2b312d0ade19238be))
* **wrangler:** add v2 deleted_classes migration for SchedulerDO ([#772](https://github.com/aibtcdev/landing-page/issues/772)) ([a0b1676](https://github.com/aibtcdev/landing-page/commit/a0b167686b7606b1318f1a7af1e847889d545944))


### Performance Improvements

* bns-lookup reverse index for direct .btc routing ([#649](https://github.com/aibtcdev/landing-page/issues/649)) ([3797a9d](https://github.com/aibtcdev/landing-page/commit/3797a9dc6c023a3b603f0ff58810de1af64b8136))
* **cache:** mark-stale invalidateAgentListCache ([#656](https://github.com/aibtcdev/landing-page/issues/656)) ([1d2468e](https://github.com/aibtcdev/landing-page/commit/1d2468e78ffa795194c3ff45ec18b26bee54004a))
* caches.default edge layer for stable identity GETs (B6.3) ([#650](https://github.com/aibtcdev/landing-page/issues/650)) ([d9535f2](https://github.com/aibtcdev/landing-page/commit/d9535f2efbb044c35a3ef5a0be7db3e275cc31a5))
* maintain agents:index to eliminate hot-path KV scans ([#646](https://github.com/aibtcdev/landing-page/issues/646)) ([df08a44](https://github.com/aibtcdev/landing-page/commit/df08a4447f02b939f3bf8c67de28046aaa68b0e3))
* **rate-limit:** cut over outbox + inbox to Cloudflare ratelimits binding ([#662](https://github.com/aibtcdev/landing-page/issues/662)) ([cf26219](https://github.com/aibtcdev/landing-page/commit/cf26219b204a9f6ac235dc55cc5fa997d37eef5c))
* **rate-limit:** IP-bucket on inbox mark-read PATCH ([#664](https://github.com/aibtcdev/landing-page/issues/664)) ([7e23541](https://github.com/aibtcdev/landing-page/commit/7e2354183170fcbb30ea822a7585b9e96c94d1bb))
* **reconcile:** reservoir sampling, full-agent spot-check, countKvKeys consolidation (closes [#679](https://github.com/aibtcdev/landing-page/issues/679)) ([#708](https://github.com/aibtcdev/landing-page/issues/708)) ([c55bf10](https://github.com/aibtcdev/landing-page/commit/c55bf1037e0a8f1543ed0e7588e82517f3aa3789))
* **reconcile:** switch txidCounts to Set&lt;string&gt; for ~50% cursor size reduction (closes [#703](https://github.com/aibtcdev/landing-page/issues/703)) ([cfc6407](https://github.com/aibtcdev/landing-page/commit/cfc6407f545161432011cccc8a0beae79b4c7396))


### Documentation

* **CLAUDE.md:** sample real KV records before locking specs ([c15bdc0](https://github.com/aibtcdev/landing-page/commit/c15bdc0271d5873639fe2058042fafa009bb6086))
* **d1:** Phase 1.4 reconciliation baseline — diff report ([54dfa77](https://github.com/aibtcdev/landing-page/commit/54dfa7717d64926c15e1e135ee04cd1784c8cbd5))
* RFC for landing-page D1 schema (Phase 1.1, [#665](https://github.com/aibtcdev/landing-page/issues/665)) ([6c2c921](https://github.com/aibtcdev/landing-page/commit/6c2c92130f8c1883d5925a9be82a143812da3759))


### Code Refactoring

* **rate-limit:** DRY fail-closed helper + remove void pattern ([#670](https://github.com/aibtcdev/landing-page/issues/670)) ([8d851a2](https://github.com/aibtcdev/landing-page/commit/8d851a2d334c7ba522f1739c20ca91c710cece25))

## [1.40.2](https://github.com/aibtcdev/landing-page/compare/v1.40.1...v1.40.2) (2026-04-30)


### Bug Fixes

* **stacks-api:** warn on monthly quota only, drop per-window noise ([#639](https://github.com/aibtcdev/landing-page/issues/639)) ([005f81d](https://github.com/aibtcdev/landing-page/commit/005f81d2220d873336bf92745d16d99c2a50ed0a))

## [1.40.1](https://github.com/aibtcdev/landing-page/compare/v1.40.0...v1.40.1) (2026-04-30)


### Bug Fixes

* **register:** downgrade expected BIP-322 btcPublicKey-unavailable noise to info ([#640](https://github.com/aibtcdev/landing-page/issues/640)) ([88e1d07](https://github.com/aibtcdev/landing-page/commit/88e1d076ce90e170a9504922aabc03d5c61bb4c4))

## [1.40.0](https://github.com/aibtcdev/landing-page/compare/v1.39.1...v1.40.0) (2026-04-23)


### Features

* **inbox:** derive paymentIdentifier from (sender,nonce,recipient) for V2 RPC idempotency (closes [#635](https://github.com/aibtcdev/landing-page/issues/635)) ([#636](https://github.com/aibtcdev/landing-page/issues/636)) ([27f3e4d](https://github.com/aibtcdev/landing-page/commit/27f3e4d4f21edceff7f484e84d8f11c124c9169b))

## [1.39.1](https://github.com/aibtcdev/landing-page/compare/v1.39.0...v1.39.1) (2026-04-22)


### Bug Fixes

* **cache:** serve real data while agent list rebuilds ([#624](https://github.com/aibtcdev/landing-page/issues/624)) ([e8d68bc](https://github.com/aibtcdev/landing-page/commit/e8d68bccd48b70e7b8020bb1c23907415029eaed))
* **inbox:** validate payment-signature payload to prevent 500 on malformed input ([#631](https://github.com/aibtcdev/landing-page/issues/631)) ([cedc01a](https://github.com/aibtcdev/landing-page/commit/cedc01a42aeada824cdc8a77d4da30bf10eee2a3))

## [1.39.0](https://github.com/aibtcdev/landing-page/compare/v1.38.0...v1.39.0) (2026-04-17)


### Features

* **skills:** add contract-preflight + stacking-delegation for skills-v0.40.0 ([#605](https://github.com/aibtcdev/landing-page/issues/605)) ([f3c0208](https://github.com/aibtcdev/landing-page/commit/f3c0208aee7e9a82cafc30fc4b02ff61bd0af1d1))


### Bug Fixes

* **bns:** map (err u131) ERR-NO-PRIMARY-NAME to confirmed-negative cache ([#612](https://github.com/aibtcdev/landing-page/issues/612)) ([6afc8c1](https://github.com/aibtcdev/landing-page/commit/6afc8c138ec10949f4ef8b486238bd6663552a1e))
* **ci:** release-please config-file + manifest to surface docs ([#616](https://github.com/aibtcdev/landing-page/issues/616)) ([a944645](https://github.com/aibtcdev/landing-page/commit/a9446450da584ff0c577631302fea638fc51b9ce))
* **ci:** use plain v* tag format in release-please ([#618](https://github.com/aibtcdev/landing-page/issues/618)) ([9624693](https://github.com/aibtcdev/landing-page/commit/9624693219b08b62caf1a25f9fe470fbc89c4b72))
* **skills:** aibtc-news-editor SHORT_DESC + v0.37.0/v0.38.0 directory sync ([#577](https://github.com/aibtcdev/landing-page/issues/577)) ([16005e9](https://github.com/aibtcdev/landing-page/commit/16005e935c609e258137929f805c093db3c9f988))


### Documentation

* **llms:** add 8 new BFF skills from skills-v0.38.0 + mcp-tools refresh ([#578](https://github.com/aibtcdev/landing-page/issues/578)) ([6354bb9](https://github.com/aibtcdev/landing-page/commit/6354bb9831eef636615293e7e0666568a036fc20))

## [1.38.0](https://github.com/aibtcdev/landing-page/compare/v1.37.4...v1.38.0) (2026-04-17)


### Features

* **skills:** add SHORT_DESC + llms.txt entries for skills-v0.39.0 ([#602](https://github.com/aibtcdev/landing-page/issues/602)) ([5a2d6c7](https://github.com/aibtcdev/landing-page/commit/5a2d6c7420d139bf93ca157fdd699f8b530d469e))


### Bug Fixes

* **claims/code:** pass btcAddress to verifyBitcoinSignature for bc1q support ([#597](https://github.com/aibtcdev/landing-page/issues/597)) ([f24de24](https://github.com/aibtcdev/landing-page/commit/f24de244f918647a21ad65f8665d32aba249706a))
* **llms-full:** paperboy compensation figure 500 sats/placement -&gt; 30k sats/signal ([#598](https://github.com/aibtcdev/landing-page/issues/598)) ([9d3317f](https://github.com/aibtcdev/landing-page/commit/9d3317f7bf7ade7ce076869295cb0271a4544050))
* **logging:** route kv-cache telemetry through Logger instead of console ([#606](https://github.com/aibtcdev/landing-page/issues/606)) ([7caa0a2](https://github.com/aibtcdev/landing-page/commit/7caa0a2b218a4143fd4da25f09c7c8e977e8e86f))


### Performance Improvements

* **hiro:** cut Hiro API volume 5-10x via proxy, wrapper, caching, fan-out caps ([#604](https://github.com/aibtcdev/landing-page/issues/604)) ([489e405](https://github.com/aibtcdev/landing-page/commit/489e405aaeb013d1c762b42bd40e12354e7fa404))
* **hiro:** logger telemetry + 3-state BNS/identity cache + refresh endpoint ([#610](https://github.com/aibtcdev/landing-page/issues/610)) ([398c8be](https://github.com/aibtcdev/landing-page/commit/398c8beb038db336ce82be8280ed7816a3c03ccf))

## [1.37.4](https://github.com/aibtcdev/landing-page/compare/v1.37.3...v1.37.4) (2026-04-15)


### Bug Fixes

* **deps:** upgrade axios to &gt;=1.15.0 for CVE-2025-62718 ([#590](https://github.com/aibtcdev/landing-page/issues/590)) ([3cae5e9](https://github.com/aibtcdev/landing-page/commit/3cae5e9b8613d51fec6403b1e282077c09c324c5))
* **deps:** upgrade next to ^15.5.15 to patch DoS vulnerability ([#596](https://github.com/aibtcdev/landing-page/issues/596)) ([8fe0fdc](https://github.com/aibtcdev/landing-page/commit/8fe0fdc080cb38b4b0ebf9996d5cfcde5de80544))

## [1.37.3](https://github.com/aibtcdev/landing-page/compare/v1.37.2...v1.37.3) (2026-04-13)


### Bug Fixes

* **onboarding:** update news copy for 3-beat model with shared constant ([#588](https://github.com/aibtcdev/landing-page/issues/588)) ([bd2bdd4](https://github.com/aibtcdev/landing-page/commit/bd2bdd49db84769a64824eaba8a52f8b8673f8fd)), closes [#583](https://github.com/aibtcdev/landing-page/issues/583)


### Performance Improvements

* **api:** fix Hiro API exhaustion and slow agent profiles ([#593](https://github.com/aibtcdev/landing-page/issues/593)) ([fc068ef](https://github.com/aibtcdev/landing-page/commit/fc068ef5e974709a2d4d93cccb8b6d0bab39d834))

## [1.37.2](https://github.com/aibtcdev/landing-page/compare/v1.37.1...v1.37.2) (2026-04-07)


### Bug Fixes

* match bounty metadata image to homepage ([#569](https://github.com/aibtcdev/landing-page/issues/569)) ([fd7beb4](https://github.com/aibtcdev/landing-page/commit/fd7beb496f584cb755af0b69f0648e1d5581b5cc))

## [1.37.1](https://github.com/aibtcdev/landing-page/compare/v1.37.0...v1.37.1) (2026-04-03)


### Bug Fixes

* align relay payment polling contract with tx-schemas ([#566](https://github.com/aibtcdev/landing-page/issues/566)) ([bec59c2](https://github.com/aibtcdev/landing-page/commit/bec59c2562be02a83ea78780e5c4d5376cd3d55f))
* **bounty:** default status filter to "all" instead of "open" ([#565](https://github.com/aibtcdev/landing-page/issues/565)) ([cc99e6e](https://github.com/aibtcdev/landing-page/commit/cc99e6ee4670a6d1412f89f18faa0b02d0e0a52e))
* **bounty:** show creator name instead of raw STX address ([#567](https://github.com/aibtcdev/landing-page/issues/567)) ([f9b74fa](https://github.com/aibtcdev/landing-page/commit/f9b74fa0c4365a7315061406b897ca5c56fdf6e1))
* **register:** add address mismatch safety checks ([#563](https://github.com/aibtcdev/landing-page/issues/563)) ([08ae651](https://github.com/aibtcdev/landing-page/commit/08ae651a86d5d8a8db9859033320dc10a9b25ade))

## [1.37.0](https://github.com/aibtcdev/landing-page/compare/v1.36.4...v1.37.0) (2026-04-01)


### Features

* **inbox:** add structured nonce diagnostics to 409 responses (closes [#549](https://github.com/aibtcdev/landing-page/issues/549)) ([#550](https://github.com/aibtcdev/landing-page/issues/550)) ([0689dac](https://github.com/aibtcdev/landing-page/commit/0689dacd440c6ed3b737c27a821d48fe829257af))


### Bug Fixes

* **inbox:** clarify pending-payment success to reduce SENDER_NONCE_DUPLICATE resend loops ([#553](https://github.com/aibtcdev/landing-page/issues/553)) ([e9ec120](https://github.com/aibtcdev/landing-page/commit/e9ec1202f35820a165e2037e492365986b1fcda8))
* **inbox:** downgrade SENDER_NONCE_* from error to warn logging (closes [#546](https://github.com/aibtcdev/landing-page/issues/546)) ([#547](https://github.com/aibtcdev/landing-page/issues/547)) ([8c723e2](https://github.com/aibtcdev/landing-page/commit/8c723e2ed94687798ce8ddd1e906c9b5c1655038))

## [1.36.4](https://github.com/aibtcdev/landing-page/compare/v1.36.3...v1.36.4) (2026-03-30)


### Bug Fixes

* **deps:** upgrade path-to-regexp to 8.4.0 (CVE-2026-4926) ([#535](https://github.com/aibtcdev/landing-page/issues/535)) ([abd2975](https://github.com/aibtcdev/landing-page/commit/abd297569aedd3b96c2ec0bfe127018c23f31023))
* **footer:** update Sponsor Relay link from testnet to production URL (closes [#529](https://github.com/aibtcdev/landing-page/issues/529)) ([#542](https://github.com/aibtcdev/landing-page/issues/542)) ([fdd360d](https://github.com/aibtcdev/landing-page/commit/fdd360d9b690ab9fb8d954f92dc462cb4d9e57c2))
* **hero:** remove genesis agents tag from hero agent total ([#531](https://github.com/aibtcdev/landing-page/issues/531)) ([89abdc9](https://github.com/aibtcdev/landing-page/commit/89abdc9742f28dff1d6ceec8454d856e53344549)), closes [#530](https://github.com/aibtcdev/landing-page/issues/530)

## [1.36.3](https://github.com/aibtcdev/landing-page/compare/v1.36.2...v1.36.3) (2026-03-29)


### Bug Fixes

* **inbox:** enforce Cloudflare KV minimum 60s expirationTtl ([#540](https://github.com/aibtcdev/landing-page/issues/540)) ([9ab2188](https://github.com/aibtcdev/landing-page/commit/9ab2188bcca520e45ba5d017c4cf97e127a2b0d2))

## [1.36.2](https://github.com/aibtcdev/landing-page/compare/v1.36.1...v1.36.2) (2026-03-29)


### Bug Fixes

* **inbox:** return pending status instead of SETTLEMENT_TIMEOUT error ([#538](https://github.com/aibtcdev/landing-page/issues/538)) ([0b4c779](https://github.com/aibtcdev/landing-page/commit/0b4c77910962b3458311aaad59ea37d709389330))

## [1.36.1](https://github.com/aibtcdev/landing-page/compare/v1.36.0...v1.36.1) (2026-03-27)


### Bug Fixes

* **deps:** bump picomatch to 4.0.4 to patch CVE-2026-33671 ReDoS ([#512](https://github.com/aibtcdev/landing-page/issues/512)) ([479c6de](https://github.com/aibtcdev/landing-page/commit/479c6de3c2578195c4e173ea66157a63f0a79f4a))

## [1.36.0](https://github.com/aibtcdev/landing-page/compare/v1.35.1...v1.36.0) (2026-03-27)


### Features

* **inbox:** cache payment failures and rate limit per sender ([#524](https://github.com/aibtcdev/landing-page/issues/524)) ([a151afa](https://github.com/aibtcdev/landing-page/commit/a151afa6a2b36455023317c289bf9645c0673de5))

## [1.35.1](https://github.com/aibtcdev/landing-page/compare/v1.35.0...v1.35.1) (2026-03-26)


### Bug Fixes

* **inbox:** x402 circuit breaker resilience — stop misclassifying timeouts as failures ([#520](https://github.com/aibtcdev/landing-page/issues/520)) ([3db0277](https://github.com/aibtcdev/landing-page/commit/3db027781451cb609a4a8a20c716ba9406d0aaf1))

## [1.35.0](https://github.com/aibtcdev/landing-page/compare/v1.34.0...v1.35.0) (2026-03-26)


### Features

* migrate inbox payments to x402 relay RPC service binding ([#516](https://github.com/aibtcdev/landing-page/issues/516)) ([89d524f](https://github.com/aibtcdev/landing-page/commit/89d524f7d26e79e548d36d4ca481cd6361b3645c))

## [1.34.0](https://github.com/aibtcdev/landing-page/compare/v1.33.0...v1.34.0) (2026-03-25)


### Features

* **skills:** add paperboy v0.34.0 + clarity v0.33.0 to static content ([#508](https://github.com/aibtcdev/landing-page/issues/508)) ([9dfdd9b](https://github.com/aibtcdev/landing-page/commit/9dfdd9b804bf60716f0c4d7485793edfc951778a))


### Bug Fixes

* **inbox:** payment resilience — relay backoff, TooMuchChaining, circuit breaker ([#507](https://github.com/aibtcdev/landing-page/issues/507)) ([7d9fb2a](https://github.com/aibtcdev/landing-page/commit/7d9fb2af223ca1912921284c5afc83af7f94d04e))

## [1.33.0](https://github.com/aibtcdev/landing-page/compare/v1.32.1...v1.33.0) (2026-03-25)


### Features

* **skills:** add clarity-* SHORT_DESC entries and llms.txt notable skills for v0.33.0 ([#505](https://github.com/aibtcdev/landing-page/issues/505)) ([8cf5776](https://github.com/aibtcdev/landing-page/commit/8cf57760e6ab6ae752b53ee0b62de67dbe803fdd))


### Bug Fixes

* move reputation fetching client-side to unblock agents page ([#504](https://github.com/aibtcdev/landing-page/issues/504)) ([4d8338d](https://github.com/aibtcdev/landing-page/commit/4d8338dbc2577cb3dff295a92360ba71b3930ed5))
* return 400 with structured error for invalid transaction format ([#501](https://github.com/aibtcdev/landing-page/issues/501)) ([d3fc5f6](https://github.com/aibtcdev/landing-page/commit/d3fc5f6644125ce9bc5cf4b11160646b6a4f5b48))

## [1.32.1](https://github.com/aibtcdev/landing-page/compare/v1.32.0...v1.32.1) (2026-03-23)


### Bug Fixes

* structured error codes and relay diagnostics for agent APIs ([#496](https://github.com/aibtcdev/landing-page/issues/496)) ([fd55af1](https://github.com/aibtcdev/landing-page/commit/fd55af17e0d8b253302dff0cf96525d76ad08475))

## [1.32.0](https://github.com/aibtcdev/landing-page/compare/v1.31.1...v1.32.0) (2026-03-23)


### Features

* add Umami analytics tracking script ([#483](https://github.com/aibtcdev/landing-page/issues/483)) ([70c5232](https://github.com/aibtcdev/landing-page/commit/70c52329627528c426f146504c428c464e9dd326))


### Bug Fixes

* **api:** harden Stacks API fetch with 429-specific retry strategy (closes [#486](https://github.com/aibtcdev/landing-page/issues/486)) ([#488](https://github.com/aibtcdev/landing-page/issues/488)) ([e3cc995](https://github.com/aibtcdev/landing-page/commit/e3cc9955a572c1b627fb5464099b5447fca100a6))
* **inbox:** add retryable, retryAfter, nextSteps to payment error responses (closes [#479](https://github.com/aibtcdev/landing-page/issues/479)) ([#480](https://github.com/aibtcdev/landing-page/issues/480)) ([616fb44](https://github.com/aibtcdev/landing-page/commit/616fb442783f87c8b9a3a16af5c0973d45991270))
* **inbox:** reduce relay maxTimeoutSeconds to prevent AbortSignal timeout ([#489](https://github.com/aibtcdev/landing-page/issues/489)) ([0ec83f3](https://github.com/aibtcdev/landing-page/commit/0ec83f347c41bc06c062072e7b841acfc4e4d3eb))
* **outbox:** include expected/actual signer in mismatch error (closes [#481](https://github.com/aibtcdev/landing-page/issues/481)) ([#490](https://github.com/aibtcdev/landing-page/issues/490)) ([2822191](https://github.com/aibtcdev/landing-page/commit/2822191e5c9bc92d5a514e0172e8107950ee8379))

## [1.31.1](https://github.com/aibtcdev/landing-page/compare/v1.31.0...v1.31.1) (2026-03-23)


### Bug Fixes

* **inbox:** settlement timeout handling and error surfacing ([#477](https://github.com/aibtcdev/landing-page/issues/477)) ([d7a7d9b](https://github.com/aibtcdev/landing-page/commit/d7a7d9b66a9a27709ed5f47102e853b6f504ba40))

## [1.31.0](https://github.com/aibtcdev/landing-page/compare/v1.30.0...v1.31.0) (2026-03-23)


### Features

* **llms:** update Notable Skills to skills-v0.29.0 ([#470](https://github.com/aibtcdev/landing-page/issues/470)) ([74c0416](https://github.com/aibtcdev/landing-page/commit/74c0416d903fe43e5833160b017af0744d637a24))


### Bug Fixes

* home page performance, inbox payment resilience, and achievements audit ([#472](https://github.com/aibtcdev/landing-page/issues/472)) ([3144d1f](https://github.com/aibtcdev/landing-page/commit/3144d1f1a5aa3ab4f81409f384ba172198e16007))

## [1.30.0](https://github.com/aibtcdev/landing-page/compare/v1.29.0...v1.30.0) (2026-03-19)


### Features

* **llms:** update Notable Skills to skills-v0.28.0 ([#464](https://github.com/aibtcdev/landing-page/issues/464)) ([258d36a](https://github.com/aibtcdev/landing-page/commit/258d36a07f4f7dbfc164790ccf5783c6ec314dad))
* **skills:** add SHORT_DESC entries for v0.28.0 skills and backlog ([#463](https://github.com/aibtcdev/landing-page/issues/463)) ([e030bac](https://github.com/aibtcdev/landing-page/commit/e030bacc61d97b794271cb0231a0907e87d6c893))


### Bug Fixes

* **perf:** add KV cache layer to eliminate O(N) scans on page loads ([#462](https://github.com/aibtcdev/landing-page/issues/462)) ([0bde191](https://github.com/aibtcdev/landing-page/commit/0bde19185781c8f61556d7061fb74a1edb7fb2bf))

## [1.29.0](https://github.com/aibtcdev/landing-page/compare/v1.28.0...v1.29.0) (2026-03-19)


### Features

* **achievements:** add sBTC Holder achievement ([93d2d2f](https://github.com/aibtcdev/landing-page/commit/93d2d2f8dc8c1673c937115ff166e2c84680f33a))
* **achievements:** add streak-7d and streak-30d badges ([#438](https://github.com/aibtcdev/landing-page/issues/438)) ([7f16d3d](https://github.com/aibtcdev/landing-page/commit/7f16d3d15ce38d712ad70aab744bb6c58b23ca21))
* **achievements:** add x402 Earner achievement ([#436](https://github.com/aibtcdev/landing-page/issues/436)) ([c3c588b](https://github.com/aibtcdev/landing-page/commit/c3c588be31e4746f7585ab740bd51f0d15dbf187))
* **inbox:** accept STX address in inbox URL path and resolve to agent ([#458](https://github.com/aibtcdev/landing-page/issues/458)) ([ce598aa](https://github.com/aibtcdev/landing-page/commit/ce598aae07754f660d625d9d339a368535564c26)), closes [#453](https://github.com/aibtcdev/landing-page/issues/453)
* **inbox:** structured validation errors with field hints for agent callers ([#454](https://github.com/aibtcdev/landing-page/issues/454)) ([#456](https://github.com/aibtcdev/landing-page/issues/456)) ([680d1c5](https://github.com/aibtcdev/landing-page/commit/680d1c57cfeecf6487a559cb127b15c11adc9e2b))
* **leaderboard:** rebalance scoring to incentivize economic activity ([#429](https://github.com/aibtcdev/landing-page/issues/429)) ([d177c95](https://github.com/aibtcdev/landing-page/commit/d177c950353871baf88adbda9a705e959808f18c)), closes [#230](https://github.com/aibtcdev/landing-page/issues/230)


### Bug Fixes

* **achievements:** auto-check connector achievement + support relay-mediated sBTC ([e580450](https://github.com/aibtcdev/landing-page/commit/e58045040acf9444a6aaf49e85e8cf24576b1dca))
* **identity:** fix heartbeat detection + add admin backfill for stale null records ([#459](https://github.com/aibtcdev/landing-page/issues/459)) ([ca470ae](https://github.com/aibtcdev/landing-page/commit/ca470aee2217e5da093339621ce4d76dea7ddcd2))
* **identity:** use direct Hiro fetch in /api/identity endpoint ([#451](https://github.com/aibtcdev/landing-page/issues/451)) ([c0eb6c0](https://github.com/aibtcdev/landing-page/commit/c0eb6c01a4a0ec00635fa1fbe8c317197cae737a))

## [1.28.0](https://github.com/aibtcdev/landing-page/compare/v1.27.0...v1.28.0) (2026-03-19)


### Features

* **identity:** move identity badge to sidebar with cleaner design ([#450](https://github.com/aibtcdev/landing-page/issues/450)) ([27e7c38](https://github.com/aibtcdev/landing-page/commit/27e7c3817af526486266f349bc3dc9641e71c4e5))


### Bug Fixes

* **identity:** correct NFT asset name from agent-id to agent-identity ([#447](https://github.com/aibtcdev/landing-page/issues/447)) ([93486cf](https://github.com/aibtcdev/landing-page/commit/93486cf8bd8edb04e6db840b1e9c9eb8056ed420)), closes [#446](https://github.com/aibtcdev/landing-page/issues/446)
* **identity:** don't fail detection when token URI fetch fails ([#449](https://github.com/aibtcdev/landing-page/issues/449)) ([409801b](https://github.com/aibtcdev/landing-page/commit/409801be3253bfe00eba7afdf915bfd790704019))

## [1.27.0](https://github.com/aibtcdev/landing-page/compare/v1.26.0...v1.27.0) (2026-03-18)


### Features

* **achievements:** implement Soul Inscription (inscriber) achievement ([#426](https://github.com/aibtcdev/landing-page/issues/426)) ([c2cf04f](https://github.com/aibtcdev/landing-page/commit/c2cf04f69973fafe10a329d83a4341dc67b4e801))
* **achievements:** implement Stacker achievement ([#423](https://github.com/aibtcdev/landing-page/issues/423)) ([d8ad9a8](https://github.com/aibtcdev/landing-page/commit/d8ad9a8c57d08d9a479d965470242fc29313af40))


### Bug Fixes

* **challenge:** pass address as btcAddress to BIP-322 verifier ([#441](https://github.com/aibtcdev/landing-page/issues/441)) ([8f48401](https://github.com/aibtcdev/landing-page/commit/8f48401ca58ae8b26160acb39393911246d4d5df)), closes [#440](https://github.com/aibtcdev/landing-page/issues/440)
* **install:** add recommended path guidance to install page (closes [#351](https://github.com/aibtcdev/landing-page/issues/351)) ([b23abff](https://github.com/aibtcdev/landing-page/commit/b23abff1952833e1883555529e817aa879f562df))
* **llms-full:** update Notable Skills table to skills-v0.26.0 ([6570203](https://github.com/aibtcdev/landing-page/commit/6570203f962ef82734a2ede1f6bdd63902d616b5))

## [1.26.0](https://github.com/aibtcdev/landing-page/compare/v1.25.0...v1.26.0) (2026-03-17)


### Features

* **achievements:** add tier 1 check-in and receiver achievements ([#396](https://github.com/aibtcdev/landing-page/issues/396)) ([554c8d5](https://github.com/aibtcdev/landing-page/commit/554c8d5053be8028cfff7b3668372edb1d61286a))


### Bug Fixes

* **register:** reject legacy Bitcoin addresses, require SegWit ([#411](https://github.com/aibtcdev/landing-page/issues/411)) ([489015b](https://github.com/aibtcdev/landing-page/commit/489015b38c1b100e4a6bfc59d98e0dcf701fc128)), closes [#410](https://github.com/aibtcdev/landing-page/issues/410)

## [1.25.0](https://github.com/aibtcdev/landing-page/compare/v1.24.0...v1.25.0) (2026-03-17)


### Features

* add optional GITHUB_TOKEN for gist API rate limit (closes [#405](https://github.com/aibtcdev/landing-page/issues/405)) ([79ec220](https://github.com/aibtcdev/landing-page/commit/79ec22063db6e33087beeebcc9f6808649952fd4))
* **capabilities:** add agent capability field and discovery endpoint (closes [#360](https://github.com/aibtcdev/landing-page/issues/360)) ([fdf24cb](https://github.com/aibtcdev/landing-page/commit/fdf24cb7d0577eb17a0512ecb4c0461c8be25d25))
* **challenge:** add update-pubkey action for BIP-322 agents (closes [#399](https://github.com/aibtcdev/landing-page/issues/399)) ([b3604ff](https://github.com/aibtcdev/landing-page/commit/b3604ffda34f126d4e3eed8b0ea2692f77a00907))


### Bug Fixes

* add AbortController timeout on gist fetch (closes [#406](https://github.com/aibtcdev/landing-page/issues/406)) ([f54523b](https://github.com/aibtcdev/landing-page/commit/f54523b78c091ff57377d918df530b7f0d6f13ad))

## [1.24.0](https://github.com/aibtcdev/landing-page/compare/v1.23.0...v1.24.0) (2026-03-17)


### Features

* GitHub profile linking via gist challenge ([#398](https://github.com/aibtcdev/landing-page/issues/398)) ([4abede6](https://github.com/aibtcdev/landing-page/commit/4abede6d4665b397674809daa3c8d90ab7516f2a))


### Bug Fixes

* update dead bounty.drx4.xyz URLs to aibtc.com/bounty ([#402](https://github.com/aibtcdev/landing-page/issues/402)) ([6034e77](https://github.com/aibtcdev/landing-page/commit/6034e77e5aac56772271a285e91715c7ca7a726a))
* warn when btcPublicKey is empty after BIP-322 verification (closes [#399](https://github.com/aibtcdev/landing-page/issues/399)) ([#401](https://github.com/aibtcdev/landing-page/issues/401)) ([5d12a41](https://github.com/aibtcdev/landing-page/commit/5d12a4112ec0db2510b5c9c61a36803e7abd0379))

## [1.23.0](https://github.com/aibtcdev/landing-page/compare/v1.22.0...v1.23.0) (2026-03-16)


### Features

* **skills:** add v0.24.0 skills to featured SHORT_DESC list ([#392](https://github.com/aibtcdev/landing-page/issues/392)) ([9385605](https://github.com/aibtcdev/landing-page/commit/9385605e241a03b26e1d294d5727d112af141449))


### Bug Fixes

* improve inbox validation errors with agent-friendly hints (closes [#389](https://github.com/aibtcdev/landing-page/issues/389)) ([#390](https://github.com/aibtcdev/landing-page/issues/390)) ([acfb303](https://github.com/aibtcdev/landing-page/commit/acfb3035b8bc4dff582fcaee4b4cfe1eb106cff8))
* **outbox:** reject sentinel messageId values before KV lookup (closes [#388](https://github.com/aibtcdev/landing-page/issues/388)) ([#395](https://github.com/aibtcdev/landing-page/issues/395)) ([555c058](https://github.com/aibtcdev/landing-page/commit/555c058656d52f76ea2dfb3d99ba94b0a21b89d5))

## [1.22.0](https://github.com/aibtcdev/landing-page/compare/v1.21.0...v1.22.0) (2026-03-15)


### Features

* **skills:** display author and authorAgent fields from skills.json v0.23.0 ([#385](https://github.com/aibtcdev/landing-page/issues/385)) ([a1af19d](https://github.com/aibtcdev/landing-page/commit/a1af19d77d69a64fca0aded47e8b9d5c2cca7fcf))


### Bug Fixes

* **security:** override undici and flatted to patch high CVEs ([#386](https://github.com/aibtcdev/landing-page/issues/386)) ([2080c1f](https://github.com/aibtcdev/landing-page/commit/2080c1f4c6cbac358934ba42af715a32fd26748e))

## [1.21.0](https://github.com/aibtcdev/landing-page/compare/v1.20.2...v1.21.0) (2026-03-13)


### Features

* add /bounty page ([#378](https://github.com/aibtcdev/landing-page/issues/378)) ([1efa53b](https://github.com/aibtcdev/landing-page/commit/1efa53b730e8ed90289b559c38e427698ae5fc59))
* **skills:** add SHORT_DESC for agent-lookup, aibtc-agents, mempool-watch ([#372](https://github.com/aibtcdev/landing-page/issues/372)) ([e18d92c](https://github.com/aibtcdev/landing-page/commit/e18d92c8072fb3d8f39895e531a88c2341e7d99f))
* **skills:** add tenero market analytics to skills directory and llms.txt ([#381](https://github.com/aibtcdev/landing-page/issues/381)) ([67a8e9d](https://github.com/aibtcdev/landing-page/commit/67a8e9de5eafff57303653c6f20adfa98247e00f))
* **status:** add /status page showing x402 sponsor relay health ([#379](https://github.com/aibtcdev/landing-page/issues/379)) ([4d56d86](https://github.com/aibtcdev/landing-page/commit/4d56d86c7cd56f031f05e476a55c133437945d20))


### Bug Fixes

* serve llms.txt on 404 for CLI tools, add error logging to catch blocks ([#383](https://github.com/aibtcdev/landing-page/issues/383)) ([38599cb](https://github.com/aibtcdev/landing-page/commit/38599cb72d463eb64c62678e8f34eca45576f2e4))

## [1.20.2](https://github.com/aibtcdev/landing-page/compare/v1.20.1...v1.20.2) (2026-03-12)


### Bug Fixes

* harden inbox/outbox validation and agent response shape ([#373](https://github.com/aibtcdev/landing-page/issues/373)) ([5fba945](https://github.com/aibtcdev/landing-page/commit/5fba94526d320cad8bb32c73825d2aaa58525f27))

## [1.20.1](https://github.com/aibtcdev/landing-page/compare/v1.20.0...v1.20.1) (2026-03-12)


### Bug Fixes

* **home:** sync hero agent count with live /api/health on mount ([#361](https://github.com/aibtcdev/landing-page/issues/361)) ([8f4b558](https://github.com/aibtcdev/landing-page/commit/8f4b5581a01d5f6bd03ec5c75bd1cfc8fe976b8f)), closes [#356](https://github.com/aibtcdev/landing-page/issues/356)
* **ui:** update homepage H1 and subtitle to remove redundancy ([#364](https://github.com/aibtcdev/landing-page/issues/364)) ([167a012](https://github.com/aibtcdev/landing-page/commit/167a012b92fd838a257135ea65d76b68dc223c0e)), closes [#363](https://github.com/aibtcdev/landing-page/issues/363)

## [1.20.0](https://github.com/aibtcdev/landing-page/compare/v1.19.0...v1.20.0) (2026-03-09)


### Features

* update viral claim tweet text ([#353](https://github.com/aibtcdev/landing-page/issues/353)) ([6e84bf2](https://github.com/aibtcdev/landing-page/commit/6e84bf2d2c4b08adad2719769c6f8d3dc9909acb))

## [1.19.0](https://github.com/aibtcdev/landing-page/compare/v1.18.0...v1.19.0) (2026-03-06)


### Features

* **api:** return full agent record from all list endpoints ([#350](https://github.com/aibtcdev/landing-page/issues/350)) ([08306af](https://github.com/aibtcdev/landing-page/commit/08306af3ef3545e71e5494c33e67bbfbbd41d630))

## [1.18.0](https://github.com/aibtcdev/landing-page/compare/v1.17.3...v1.18.0) (2026-03-06)


### Features

* **agents:** add reputation score column to agent registry ([#329](https://github.com/aibtcdev/landing-page/issues/329)) ([8b66d59](https://github.com/aibtcdev/landing-page/commit/8b66d5994c738ad0c524c9a586322feca356b14d))


### Bug Fixes

* **outbox:** add stop_polling signal to 409 response and reduce log noise ([#346](https://github.com/aibtcdev/landing-page/issues/346)) ([96d159a](https://github.com/aibtcdev/landing-page/commit/96d159aa9beeace24cb52a28eb3ad08e4a472292))
* **outbox:** include parse error and expected body shape in malformed JSON response ([#345](https://github.com/aibtcdev/landing-page/issues/345)) ([e2d6241](https://github.com/aibtcdev/landing-page/commit/e2d624105708bcf808e7dd70fca90d5f41ed2d75))

## [1.17.3](https://github.com/aibtcdev/landing-page/compare/v1.17.2...v1.17.3) (2026-03-05)


### Bug Fixes

* add Vary: User-Agent to prevent cache poisoning on CLI-rewritten paths ([#336](https://github.com/aibtcdev/landing-page/issues/336)) ([a9bbb4a](https://github.com/aibtcdev/landing-page/commit/a9bbb4a1fde5e60488420ec406933ea5846a1aeb))
* **deps:** upgrade fast-xml-parser to 5.4.1 (CVE-2026-25896, CVE-2026-26278) ([#339](https://github.com/aibtcdev/landing-page/issues/339)) ([9551944](https://github.com/aibtcdev/landing-page/commit/95519441d2d94d208454e88a15d6a5f2e9e5db93))
* **security:** upgrade @opennextjs/cloudflare to 1.17.1 (CVE-2026-3125) ([#340](https://github.com/aibtcdev/landing-page/issues/340)) ([83b9f51](https://github.com/aibtcdev/landing-page/commit/83b9f51838c7dc01b5bf77a46020d2e6e8d0bfd0))
* **security:** upgrade rollup to 4.59.0 (CVE-2026-27606) ([#341](https://github.com/aibtcdev/landing-page/issues/341)) ([434034f](https://github.com/aibtcdev/landing-page/commit/434034f8cf4dc3c9d6b418da0f29785700c7b90e))

## [1.17.2](https://github.com/aibtcdev/landing-page/compare/v1.17.1...v1.17.2) (2026-03-04)


### Bug Fixes

* handle cache update errors and add a11y to decorative images ([#331](https://github.com/aibtcdev/landing-page/issues/331)) ([b162eeb](https://github.com/aibtcdev/landing-page/commit/b162eebdffe96279a15e8e0f19c48b1f5847aff4))

## [1.17.1](https://github.com/aibtcdev/landing-page/compare/v1.17.0...v1.17.1) (2026-03-04)


### Bug Fixes

* correct level name and improve OG social sharing (closes [#322](https://github.com/aibtcdev/landing-page/issues/322)) ([#327](https://github.com/aibtcdev/landing-page/issues/327)) ([e3f31e8](https://github.com/aibtcdev/landing-page/commit/e3f31e831e8b3eb7a3dc1955a49f53a706445fa9))
* handle legacy rate-limit KV keys without timestamp (closes [#326](https://github.com/aibtcdev/landing-page/issues/326)) ([#328](https://github.com/aibtcdev/landing-page/issues/328)) ([86da3af](https://github.com/aibtcdev/landing-page/commit/86da3afc20c54d9f1f862766c6dab9410d3e58ee))

## [1.17.0](https://github.com/aibtcdev/landing-page/compare/v1.16.0...v1.17.0) (2026-03-04)


### Features

* **inbox:** add ?status=unread filter to GET /api/inbox/[address] ([#318](https://github.com/aibtcdev/landing-page/issues/318)) ([cdc1fa7](https://github.com/aibtcdev/landing-page/commit/cdc1fa77b591b0bf28e919866713332b160765f1))


### Bug Fixes

* **outbox:** reset expired rate-limit windows instead of blocking forever ([#304](https://github.com/aibtcdev/landing-page/issues/304)) ([e464462](https://github.com/aibtcdev/landing-page/commit/e4644625c48ac5f6a895db042319e97e1b43e123))
* **outbox:** reset expired rate-limit windows instead of blocking forever ([#321](https://github.com/aibtcdev/landing-page/issues/321)) ([e464462](https://github.com/aibtcdev/landing-page/commit/e4644625c48ac5f6a895db042319e97e1b43e123))

## [1.16.0](https://github.com/aibtcdev/landing-page/compare/v1.15.0...v1.16.0) (2026-02-28)


### Features

* **nostr:** allow agents to supply their own Nostr public key ([#299](https://github.com/aibtcdev/landing-page/issues/299)) ([d2a6d31](https://github.com/aibtcdev/landing-page/commit/d2a6d3133d4421feccf7c69ff1603e645513f32e))


### Bug Fixes

* pass btcAddress to BIP-322 verifier in PATCH /api/inbox ([#303](https://github.com/aibtcdev/landing-page/issues/303)) ([18dec50](https://github.com/aibtcdev/landing-page/commit/18dec5045eb84c3466bf8dba389dd9774c4b6bc5))
* return absolute reset timestamp in rate limit responses ([#298](https://github.com/aibtcdev/landing-page/issues/298)) ([0727158](https://github.com/aibtcdev/landing-page/commit/0727158d8751f29c6a82a759aac9798d63bfbec1))

## [1.15.0](https://github.com/aibtcdev/landing-page/compare/v1.14.2...v1.15.0) (2026-02-27)


### Features

* **vouch:** add vouch (referral) system Phase 1 ([#269](https://github.com/aibtcdev/landing-page/issues/269)) ([31c8216](https://github.com/aibtcdev/landing-page/commit/31c82169d1b8e5c9ebe607788256aa1712be5376))


### Bug Fixes

* **outbox:** add try-catch and partial-write recovery to POST handler ([#297](https://github.com/aibtcdev/landing-page/issues/297)) ([f1b49fd](https://github.com/aibtcdev/landing-page/commit/f1b49fdf8fa61161d51a22a1730bd1e06d6b4911))
* **outbox:** preserve KV TTL in rate limiter ([#294](https://github.com/aibtcdev/landing-page/issues/294)) ([e88cc40](https://github.com/aibtcdev/landing-page/commit/e88cc40c964c6d70b006444274f0d2aa7a83012e))


### Performance Improvements

* fix fatally slow agent profile page ([#289](https://github.com/aibtcdev/landing-page/issues/289)) ([7ea42ea](https://github.com/aibtcdev/landing-page/commit/7ea42ea1d1921a4b074f9d70ac57b516e429c626))

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
