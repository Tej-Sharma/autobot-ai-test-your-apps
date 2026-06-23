# {{APP_NAME}} — webbot flow definitions

> Written by `webbot init` discovery. Edit freely — this file is the source of truth
> for what gets tested. Flows are prose, not a DSL; describe steps the way you'd
> explain them to a person.

## App overview

{{APP_OVERVIEW}}

## Base URL & auth

- Base URL: {{BASE_URL}}
- Auth: {{AUTH_NOTES}}
  <!-- If the app needs login, runs sign in with the test credentials in the run
       context (managed via `webbot creds`); every flow starts authenticated. Don't
       hardcode the password here — it lives in .webbot/config.json. -->

## Critical flows

{{FLOWS}}

## App-specific rubric extensions

<!-- Extra critique rules for this app, e.g. "brand color is #4F46E5 — flag drift" -->

## Known gotchas

<!-- e.g. "the dashboard fetch takes ~3s on cold start — not a stuck spinner" -->
