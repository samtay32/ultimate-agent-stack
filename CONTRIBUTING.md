# Contributing

Thanks for helping improve Ultimate Agent Stack.

## Before Opening a Pull Request

1. Use Node.js 22 or newer.
2. Install development dependencies without lifecycle scripts:

   ```bash
   npm ci --ignore-scripts
   ```

3. Keep changes focused and preserve the package's zero-runtime-dependency
   design unless a demonstrated requirement makes a dependency necessary.
4. Run the complete local gate:

   ```bash
   npm run release:check
   ```

Behavior changes must update the relevant deterministic contracts and fixture
baselines. Claims about model or harness behavior also need the exact-harness,
exact-model evidence described in [the release guide](docs/RELEASE.md).

Do not include credentials, private traces, or customer data in issues, commits,
or test fixtures. Report security concerns through [SECURITY.md](SECURITY.md)
instead of a public issue.

## Pull Requests

Explain the user-visible problem, the smallest chosen solution, the tests run,
and any known limitation. Maintainers may decline additional machinery when a
simpler change satisfies the demonstrated need.
