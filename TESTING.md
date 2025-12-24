# Testing Guide

This project uses [Vitest](https://vitest.dev/) for unit testing.

The only tests that are done currently are for the retargeting area. There are many permutations for the bone mappings, so this helps speed up testing all these scenarios. There aren't that many of them, so I am not running those as part of any build pipelines. 

    npm test


## Current Test Coverage

- ✅ `BoneCategoryMapper`
  - Torso bones mapping
  - Arm bones mapping
  - Hand bones mapping
  - Leg bones mapping
  - Wing bones mapping
  - Tail bones mapping
  - Unknown bones mapping
  - Edge cases (empty arrays, case sensitivity, special characters)

## Configuration

Testing configuration is in `vitest.config.ts`:

- **Environment**: jsdom (for DOM-related code)
- **Globals**: Enabled (no need to import describe/it/expect in every file)
- **Coverage**: v8 provider with text, JSON, and HTML reporters