# decode-uri-component CommonJS compatibility package

This local package carries the upstream `decode-uri-component@0.5.0` linear-time decoder from commit [`fa479da`](https://github.com/SamVerschueren/decode-uri-component/commit/fa479da), with its default export adapted to CommonJS.

`query-string@7.1.3` calls this dependency with `require()` and expects the result itself to be a function. The upstream 0.5.0 package is ESM-only, so a direct npm override would break that consumer. Keep this package aligned with upstream decoder fixes and retain the upstream MIT license in `license`.
