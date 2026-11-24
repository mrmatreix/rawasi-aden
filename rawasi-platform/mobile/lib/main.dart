import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'app/role_router.dart';
import 'app/unavailable_repository.dart';

void main() => runApp(const RawasiApp());

class RawasiApp extends StatelessWidget {
  const RawasiApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp(
    title: 'رواسي', debugShowCheckedModeBanner: false,
    locale: const Locale('ar'), supportedLocales: const [Locale('ar')],
    localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
    theme: ThemeData(useMaterial3: true, colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff134b5f)), scaffoldBackgroundColor: const Color(0xfff5f8f9)),
    home: const RoleBasedAppRouter(repository: UnavailableRepository()),
  );
}
