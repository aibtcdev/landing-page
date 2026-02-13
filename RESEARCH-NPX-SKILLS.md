# Research: `npx skills add` Format and AIBTC Skill Placement

## Executive Summary

The AIBTC skill **already exists** in the `aibtc-mcp-server` repository and is properly structured for the `npx skills add` workflow. The MCP server is the correct home for the skill, and the landing-page serves as the discovery hub via llms.txt and agent.json.

**Recommendation:** Enhance the existing skill with cross-references to landing-page discovery docs, and ensure the landing-page properly links to the skill for discoverability.

## Skills Format Research

### What is `npx skills add`?

The `npx skills add` command is part of an open ecosystem for AI agent skills. It supports multiple formats:

- **GitHub shorthand**: `npx skills add owner/repo`
- **Full GitHub URL**: `npx skills add https://github.com/owner/repo`
- **Specific paths**: `npx skills add owner/repo/path/to/skill`
- **Local paths**: `npx skills add ./local-skill-dir`

**Sources:**
- [Extend Claude with skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
- [GitHub - anthropics/skills: Public repository for Agent Skills](https://github.com/anthropics/skills)
- [GitHub - vercel-labs/skills: The open agent skills tool](https://github.com/vercel-labs/skills)

### Skill Structure

Skills follow a simple markdown-based format:

```markdown
---
name: skill-identifier
description: Clear description of what this skill does and when to use it
---

# Skill Title

[Instructions that Claude will follow when this skill is active]

## Examples
- Usage example 1
- Usage example 2

## Guidelines
- Best practice 1
- Best practice 2
```

**Key components:**
1. **YAML frontmatter** with `name` and `description` (required)
2. **Markdown content** with instructions, examples, and guidelines
3. **Optional reference files** in subdirectories for progressive disclosure

**Sources:**
- [About Claude Skills - A comprehensive guide](https://gist.github.com/stevenringo/d7107d6096e7d0cf5716196d2880d5bb)
- [Claude Skills Solve the Context Window Problem](https://tylerfolkman.substack.com/p/the-complete-guide-to-claude-skills)

### x402lint Reference

The x402lint example cited in the issue demonstrates the expected pattern:
```bash
npx skills add https://github.com/rawgroundbeef/x402lint
```

This points to a GitHub repository containing a skill. The repository structure follows the same SKILL.md format.

## Current AIBTC Implementation

### Existing Skill Location

**Repository:** `aibtcdev/aibtc-mcp-server`
**Path:** `skill/SKILL.md`
**npm Package:** `@aibtc/mcp-server` (currently v1.19.2)

The skill is already included in the published npm package via the `files` array in package.json:
```json
"files": [
  "dist",
  "README.md",
  "skill"
]
```

### Current Skill Structure

```
skill/
├── SKILL.md                    # Main skill - Bitcoin L1 core workflows
├── README.md                   # Installation and usage guide
└── references/
    ├── pillar-wallet.md        # Pillar smart wallet documentation
    ├── stacks-defi.md          # Stacks L2 DeFi documentation
    └── troubleshooting.md      # Common issues and solutions
```

The skill follows best practices:
- ✅ Proper YAML frontmatter with name, description, license, metadata
- ✅ Progressive disclosure via reference files
- ✅ Clear installation instructions
- ✅ Example workflows
- ✅ Follows [Agent Skills specification](https://agentskills.io)

### Skill Metadata

```yaml
---
name: aibtc-bitcoin-wallet
description: Bitcoin L1 wallet for agents - check balances, send BTC, manage UTXOs. Extends to Stacks L2 (STX, DeFi) and Pillar smart wallets (sBTC yield).
license: MIT
metadata:
  author: aibtcdev
  version: 1.14.2
  npm: "@aibtc/mcp-server"
  github: https://github.com/aibtcdev/aibtc-mcp-server
---
```

## Installation Methods

### Method 1: Via npm (Recommended)

When the MCP server is installed, the skill comes bundled:
```bash
npx @aibtc/mcp-server@latest --install
```

The skill is available at `node_modules/@aibtc/mcp-server/skill/`.

### Method 2: Via npx skills add

Users can add the skill directly:
```bash
npx skills add aibtcdev/aibtc-mcp-server/skill
```

Or from the GitHub URL:
```bash
npx skills add https://github.com/aibtcdev/aibtc-mcp-server/tree/main/skill
```

### Method 3: Via ClawHub

The skill can be registered with ClawHub:
```bash
npx clawhub install aibtc-bitcoin-wallet
```

Currently referenced in the skill's README but not yet confirmed as published to ClawHub registry.

## Landing Page Integration

### Current Discovery Chain

The landing-page provides multiple discovery mechanisms:

1. **HTML meta tags** - `<link rel="alternate" href="/.well-known/agent.json">`
2. **/.well-known/agent.json** - A2A protocol agent card
3. **/llms.txt** - Quick-start guide (also served at `/` for CLI tools)
4. **/llms-full.txt** - Complete reference documentation
5. **/api/openapi.json** - OpenAPI 3.1 spec

### Relationship Between Repos

```
Landing Page (aibtc.com)          MCP Server (@aibtc/mcp-server)
├── Discovery Docs                ├── Executable Tools
│   ├── llms.txt                  │   ├── dist/index.js
│   ├── llms-full.txt             │   └── 60+ MCP tools
│   ├── agent.json                │
│   └── openapi.json              └── Skill Documentation
│                                     ├── SKILL.md
└── Platform APIs                     └── references/
    ├── /api/register                     ├── pillar-wallet.md
    ├── /api/heartbeat                    ├── stacks-defi.md
    ├── /api/paid-attention               ├── inscription-workflow.md
    └── /api/inbox                        ├── genesis-lifecycle.md
                                          └── troubleshooting.md
```

**Key insight:** The MCP server owns:
- The executable MCP tools (wallet_create, btc_sign_message, etc.)
- The skill documentation (how to use those tools)

The landing-page owns:
- The platform APIs (registration, heartbeat, messaging)
- The discovery documentation (how to find and onboard)

## Placement Analysis

### Why MCP Server is the Correct Home

1. **npm Package Distribution** - The MCP server is already published to npm as `@aibtc/mcp-server`, making it the natural distribution point for the skill
2. **Tool Coupling** - The skill documents how to use the MCP tools, so they should be versioned together
3. **Progressive Disclosure** - The skill references files are tightly coupled to specific MCP tool capabilities
4. **Installation Flow** - Users install the MCP server first (prerequisite), then the skill comes bundled
5. **Single Source of Truth** - Tool capabilities and their documentation stay in sync

### Why Landing Page is NOT the Home

1. **Different Purpose** - Landing page focuses on platform APIs, not MCP tool usage
2. **Version Coupling** - Landing page APIs evolve independently from MCP tool capabilities
3. **npm Distribution** - Landing page is not an npm package, making distribution awkward
4. **Deployment Mismatch** - Landing page deploys to Cloudflare Workers, MCP tools run locally

### Role of Landing Page

The landing page should:
1. **Discover** - Point agents to the MCP server and skill via llms.txt and agent.json
2. **Onboard** - Document the platform APIs (registration, heartbeat, messaging)
3. **Link** - Reference the skill as part of the agent journey

## Sync Strategy

Since content spans two repos, here's how to keep them in sync:

### MCP Server Responsibilities

- Maintain SKILL.md with tool usage patterns
- Document MCP tool capabilities in reference files
- Version the skill alongside tool releases
- Publish skill with npm package

### Landing Page Responsibilities

- Document platform APIs (registration, heartbeat, messaging)
- Link to MCP skill in discovery docs
- Reference installation methods in llms.txt
- Keep agent journey phases aligned with skill content

### Cross-References

**From MCP skill → Landing page:**
- Link to registration flow: `https://aibtc.com/api/register`
- Link to identity guide: `https://aibtc.com/identity`
- Link to heartbeat docs: `https://aibtc.com/api/heartbeat`

**From Landing page → MCP skill:**
- Link to MCP installation: `npx @aibtc/mcp-server@latest --install`
- Reference skill availability: "The MCP server includes a skill for Bitcoin wallet operations"
- Point to GitHub skill directory: `https://github.com/aibtcdev/aibtc-mcp-server/tree/main/skill`

### Version Alignment

When MCP tools change:
1. Update SKILL.md in MCP repo
2. Update llms.txt in landing-page if platform journey changes
3. Bump version in both package.json (MCP) and skill frontmatter metadata

## Recommendations

### Immediate Actions (This Phase)

1. **Enhance skill cross-references** - Add explicit links to landing-page APIs in SKILL.md reference files
2. **Update landing-page discovery** - Add skill installation instructions to llms.txt
3. **Document installation methods** - Clarify `npx skills add` patterns in both repos
4. **Verify npm packaging** - Ensure skill directory is included in published package

### Future Enhancements

1. **ClawHub Registration** - Publish skill to ClawHub registry for discoverability
2. **Skill Variants** - Create focused sub-skills (e.g., "aibtc-pillar-wallet" just for Pillar)
3. **Version Sync Automation** - GitHub Actions to detect version drift between repos
4. **Discovery Testing** - Automated tests that verify skill can be installed via all methods

## Conclusion

The AIBTC skill is **correctly placed** in the MCP server repository. The landing-page serves as the discovery hub, pointing agents to the MCP server installation which includes the bundled skill.

**Next steps:**
1. Enhance cross-references between skill and landing-page docs
2. Update llms.txt to reference skill installation methods
3. Verify skill is accessible via `npx skills add aibtcdev/aibtc-mcp-server/skill`
4. Document the relationship in both repos' README files

**No repository migration needed** - the current structure is correct.
