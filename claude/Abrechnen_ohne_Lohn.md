# „Abrechnen ohne Lohn" – Einsatz wird berechnet, ist aber keine Arbeitszeit

Wunsch der Geschäftsleitung (23.11.2026): ein Knopf, mit dem ein Einsatz als geklärt gilt und
abgerechnet wird, **ohne** dass die Mitarbeiterin die Stunden bezahlt bekommt – und der Einsatz
bleibt dabei im Dienstplan sichtbar. Bisher blieb so ein Einsatz „offen" stehen.

Vorgabe für die Umsetzung: **Nichts Bestehendes verändern, nur ergänzen.**

## Bedienung im Büro

Ankreuzfeld **„Abrechnen ohne Lohn"** an der Dienstplan-Zeile (Tabelle Besuche, Feld
`fld3suVXm9zD3uYK8`). Ein Klick. Haken wieder entfernen = alles wie vorher.

## Regel

Ein Einsatz **mit Klient** und Haken

- bleibt ein Einsatz: Er steht weiter im Dienstplan, in beiden Wochenplänen, in der App und zählt
  weiter zu „Geplant (Std.)" bzw. den verplanten Stunden – er wird ja abgerechnet;
- gilt als **geklärt** (nicht mehr „offen" / „nicht bestätigt");
- ist **nie Arbeitszeit**: kein Ist (auch kein schon eingetragenes), keine Kunden-Anfahrt dorthin
  oder von dort, nicht in der Monatssumme, keine Zeiterfassung in der App.

An einer Zeile **ohne** Klient (Urlaub, Krank …) hat der Haken keine Bedeutung. **Ohne Haken ändert
sich nichts.**

### Abgesagt + Haken (Ergänzung 24.11.2026)

Das Büro überträgt vom **Wochendienstplan aller Mitarbeiter** die Stunden der Klienten in die
Abrechnung (PflegeX). Der häufigste Fall für den Haken ist deshalb ein **abgesagter** Einsatz, der
trotzdem berechnet wird (z. B. kurzfristige Absage):

- Für die Mitarbeiterin bleibt er abgesagt – dort geht „Abgesagt" bzw. „Storniert" vor: nicht auf dem
  Stundenzettel, im Wochenplan je Mitarbeiter und in der App als „Abgesagt".
- Im Wochendienstplan aller Mitarbeiter ist er als „abrechnen" erkennbar: Klient und Zeit sind
  durchgestrichen (violett), die Zahl mit `*` steht fett daneben und ist **nicht** durchgestrichen;
  unter der Summe der Mitarbeiterin steht `* abrechnen ohne Lohn: 1,25 Std.`
- Ein abgesagter Einsatz **ohne** Haken bleibt grau und ganz durchgestrichen wie bisher.

## Wo es wirkt

| Ausgabe | Mit Haken | Datei |
|---|---|---|
| Stundenzettel (PDF) | eigener Abschnitt „Ohne Arbeitszeit – vom Büro so eingetragen", Zeile im Summenblock, ein Absatz in der Erläuterung; **nicht** in Soll/Ist/Anfahrt/Summe, **nicht** unter „Nicht bestätigt" | `api/_zeitkonto.js` (Regel 6), `api/stundenzettel.js` |
| Wochendienstplan aller Mitarbeiter (PDF) | geplante Zeit mit `*` in Violett und fett, z. B. `1,25*` – auch am abgesagten Einsatz; nicht in „Std. bestätigt", nicht „offen"; unter der Summe `* abrechnen ohne Lohn: … Std.`; Legende bekommt auf dieser Seite den Zusatz `* = Abrechnen ohne Lohn …` | `api/_wochenuebersicht.js` |
| Wochenplan je Mitarbeiter (PDF, „Dienstplan drucken") | Hinweis „Ohne Zeiterfassung" am Einsatz, Notiz unter der Wochensumme; Einsatz und geplante Zeit zählen wie bisher | `api/_dienstplan.js` |
| Mitarbeiter-App, Karte „Heute" | statt der Eingabe „Tatsächliche Dauer" steht „Ohne Zeiterfassung" | `src/App.tsx` |
| Mitarbeiter-App, „Lohn / Zeit" | Einsatz zählt nie mit | `src/App.tsx` |
| Mitarbeiter-App, Markierung | Ankreuzen zeigt den Einsatz einmal als „Geändert" | `src/neuigkeiten.ts` |
| Zeiterfassung auf dem Server | `POST /api/besuch-dauer` lehnt ab: `409 { error: "ohne_zeiterfassung" }`, nichts wird geschrieben | `api/besuch-dauer.js` |
| Klienten-App | Die Markierung wird **nie** ausgeliefert | `api/app-data.js` |

Wortwahl: Büro-Unterlagen nennen die Sache beim Namen („Abrechnen ohne Lohn"). Alles, was die
Mitarbeiterin sieht (App, ihr Wochenplan, ihr Stundenzettel), ist neutral formuliert („Ohne
Zeiterfassung", „Ohne Arbeitszeit") und nennt weder Lohn noch Abrechnung. Auf dem Stundenzettel
steht, dass sie sich beim Büro melden soll, wenn das bei einem Einsatz nicht stimmt.

## Was bewusst gleich bleibt

- Alle bisherigen Tests laufen **unverändert** durch; neu ist nur `tests/abrechnen-ohne-lohn.test.mjs`.
- Aufbau von `summen` im Rechenkern, `summen()` des Wochendienstplans (`{min, offen}`),
  `LEGENDE` beider Pläne, `NUR_MITARBEITER_FELDER`, `ERLAEUTERUNG` und der gemerkte Fingerabdruck
  der Einsätze in der App bleiben, wie sie sind. Alles Neue erscheint nur bei gesetztem Haken.
- Vergleich main ↔ Patch mit denselben erfundenen Daten ohne Haken: 120 Stundenzettel, 240
  Wochenpläne je Mitarbeiter und 8 Wochendienstpläne sind **Byte für Byte gleich**, ebenso alle
  Antworten der Endpoints.

## Technik

- Regel an einer Stelle: `abrechnenOhneLohn(fields)` und `ohneLohnFelder(fields)` in
  `api/_abrechnung.js` (ohne Abhängigkeiten, wird auch in die App gebündelt). Nur ein gesetztes
  Ankreuzfeld (`true`) zählt.
- **Umbenennung:** Überall, wo alle Felder gelesen werden (Stundenzettel, Apps), gilt die Spalte
  auch unter einem neuen Namen, solange „ohne Lohn" darin vorkommt. Die beiden Wochenpläne fragen
  eine feste Feldliste ab; fehlt die Spalte dort (umbenannt/gelöscht), antwortet Airtable mit 422 –
  `fetchAllOptional` (`api/_lib.js`) fragt dann einmal ohne sie ab und meldet das als Alarm. Das
  Blatt entsteht trotzdem, nur ohne die Markierung.
- `termin()` liefert zusätzlich `ohneLohn`; `berechneZeitnachweis()` liefert zusätzlich die Liste
  `ohneLohn` (Datum, Von, Bis, Soll, Klient, Tätigkeit).

## Einführung – Reihenfolge beachten

1. Feld in Airtable anlegen (erledigt, noch in keinem Interface sichtbar).
2. Diesen Stand ausliefern (Branch → Vercel-Preview → Merge).
3. **Erst danach** die Spalte in die Interface-Reiter „🗓️ Mitarbeiter (Dienstplan)" und
   „⏱️ Mitarbeiter (Arbeitsstunden)" aufnehmen und veröffentlichen.

Grund: Der vorherige Stand von `/api/app-data` kennt die Spalte nicht und würde einen gesetzten
Haken an die Klienten-App übertragen (unsichtbar, aber in den Daten). Erst dieser Stand entfernt
ihn.

## Prüfen

```
npm run build                                   # tsc + alle Tests + vite build
node --test tests/abrechnen-ohne-lohn.test.mjs            # 34 Tests zur Regel
node --test tests/abgesagt-trotzdem-abrechnen.test.mjs    # 12 Tests zu „abgesagt + Haken"
```
