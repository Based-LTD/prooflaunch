# Security Policy

Proof Launch coordinates meme coin launches on Solana via Pump.fun. The platform handles real user funds (backer SOL in burner wallets, escrow operations, fee distributions), so security disclosures are taken seriously.

## Reporting a vulnerability

**Please do not open public GitHub issues for security bugs.**

Email: **dsproul@coupestudios.com**

Include:
- A clear description of the issue
- Steps to reproduce (or proof of concept)
- The impact (what an attacker could do)
- Your suggested fix, if you have one

We aim to acknowledge reports within 48 hours and to address verified issues within 7 days.

## Scope

In scope:
- The Proof Launch website (`prooflaunch.fun`)
- The Next.js API routes in `src/app/api/`
- The Solana integration in `src/services/pumpfun.ts` and `src/lib/`
- Burner wallet encryption / key handling
- Authentication and signature verification logic
- Database access patterns (Supabase)

Out of scope:
- Issues in Pump.fun itself — report to the Pump.fun team
- Issues in Solana RPC providers (Helius, Triton, mainnet-beta)
- Vulnerabilities that require physical access or social engineering of the operator
- Theoretical issues without a working exploit
- Denial of service via raw traffic volume

## What we promise

- We will not pursue legal action against good-faith researchers
- We will credit you publicly (in commit messages or release notes) if you'd like
- For high-impact findings, we may offer a discretionary bounty paid in SOL — there is no formal bounty program, but we value the work

## What we ask

- Do not publicly disclose the issue before we've had a chance to fix it
- Do not test against real user funds — set up your own test backings
- Do not attempt to access or modify data that isn't yours

## Audit history

This codebase has **not been formally audited** by a third-party security firm as of the date of this file. Internal review covers the major attack surfaces (auth, encryption, launch flow, refund flow, fee distribution). Use at your own risk; do not back amounts you aren't comfortable losing.
