<div align="center">
  <a href="https://ssnl.stanford.edu/"><img width="350" src="./.images/SSNL.jpg"></a>
  <br><br>
  <a href="https://wellping.github.io/"><img width="200" height="200" src="./assets/icon-android-foreground.png"></a>
</div>

# Well Ping

[![CI](https://github.com/wellping/wellping/actions/workflows/jest.yml/badge.svg)](https://github.com/wellping/wellping/actions/workflows/jest.yml) [![runs with expo](https://img.shields.io/badge/Runs%20with%20Expo-000.svg?style=flat-square&logo=EXPO&labelColor=f3f3f3&logoColor=000)](https://expo.dev/)

A React Native survey app that pings you once a while to answer questions!

**Download on App Store**: https://apps.apple.com/us/app/id1532364388

**Download on Google Play**: https://play.google.com/store/apps/details?id=edu.stanford.ssnl.wellping

## Docs

*Work in Progress*

- [User Docs](https://wellping.github.io/)
- [Developer Docs](https://wellping.github.io/wellping/)
- [Well Ping Study File Editor](https://wellping.github.io/study-file-editor/)

### Related Tools

- [WellPing EMA Parser](https://github.com/StanfordSocialNeuroscienceLab/wellping-ema-parser)

## Development

The modernization candidate uses Expo **57.0.30**, React Native **0.86.3**, Node **22.23.3**, and Corepack-pinned Yarn **4.18.1**.

```sh
nvm install
nvm use
corepack yarn install --immutable
corepack yarn test:ci
corepack yarn smoke:local
corepack yarn start:local
```

The isolated app previews the existing questionnaire using synthetic answers, with no login, notification scheduling, or uploads. See [local development](./docs/local-development.md) for native build requirements and [December readiness](./docs/december-readiness.md) for remaining study preparation. The original store links above are historical references, not this candidate's distribution.

### `@wellping/study-schemas`

The original locked source is packaged in `vendor/` so installation does not
rebuild a Git dependency. See [artifact provenance](./vendor/README.md).

## Deployment

This candidate has not been released. Follow the [December release runbook](./docs/release/deployment.md) and [proposed Beiwe integration contract](./docs/release/beiwe-contract.md). Client reliability changes are implemented and release builds require explicit lab configuration and backend contract approval. Hosting, server implementation, signing, physical-device evidence, and the authorized pilot remain release gates.
