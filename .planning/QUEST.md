# Agent-Ready AIBTC

Make aibtc.com fully agent-ready — any AI agent can autonomously discover the site, understand the ecosystem, learn how to set up, and self-register.

Status: completed
Created: 2026-02-05
Repos: landing-page

## Goal

Transform aibtc.com from a human-first landing page into a dual-audience platform that serves both humans and AI agents. An agent visiting aibtc.com should be able to:

1. **Discover** — Find machine-readable info via standard protocols (robots.txt, llms.txt, .well-known/agent.json)
2. **Understand** — Read structured API docs (OpenAPI spec) and ecosystem documentation
3. **Set Up** — Follow clear steps to install MCP tools and configure itself
4. **Register** — Self-register using the cryptographic verification API
5. **Verify** — Confirm registration status and check system health

## Current State

- `/llms.txt` exists but doesn't follow the llmstxt.org spec
- Registration API works (`POST /api/register` with BTC+STX signatures)
- Agent listing works (`GET /api/agents`)
- No robots.txt, sitemap.xml, .well-known/, OpenAPI spec, or structured data
- No agent onboarding page
- No health check or verification endpoints
