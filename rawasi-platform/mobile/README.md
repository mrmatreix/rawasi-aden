# Rawasi mobile — prototype

Flutter UI scaffold for the four roles. The default adapter rejects all operations because the authenticated backend endpoints are not implemented. No demo account, fake save, client-side role selection, remote deployment or fabricated credentials are provided.

The data contract in `lib/core/contracts.dart` must be implemented by an authenticated API adapter after the server contracts exist. Server-side authorization is mandatory; routing by role is a display concern only. Account issuance must use a secure one-time credential delivery mechanism; the current membership widget does not print or display a password. Image/document attachment, printing, budget input, vendor quote editing by the admin, and production-grade session restoration are not implemented.

With a Flutter SDK installed, run `flutter pub get`, `flutter analyze`, and `flutter test`. Validated with a temporary Flutter 3.50.0 SDK: `flutter test` passed six widget tests, and `flutter analyze --no-fatal-infos` passed with informational deprecation notices from that SDK. Platform-specific iOS and Android host projects still need to be generated and configured.
