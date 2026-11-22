# Gridcart: instructions for AI coding sessions

Start every session by reading `docs/PROJECT_STATUS.md`. It holds the current status, the decisions already made, how to run things on this Windows machine, known pitfalls, and the ordered backlog. Then read `docs/REQUIREMENTS.md`, `docs/DATABASE.md` and `docs/DESIGN.md`, which are the approved sources of truth.

Key rules:

- Use `npm.cmd` and `npx.cmd` in PowerShell (script execution is blocked). Do not change the execution policy.
- Never ask the user to paste secrets into chat. Never commit `.env`, uploads, product photos or build output. The GitHub repository is public.
- Ask before destructive actions and before pushing. Do not run `prisma migrate reset` without the user's explicit consent.
- Do not invent business facts. Ask the user.
- Add tests with each feature, keep them passing, and update `docs/PROJECT_STATUS.md` at the end of each step.
