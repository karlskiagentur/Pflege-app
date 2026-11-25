# Wochendienstplan aller Mitarbeiter als PDF

Ein Blatt je Woche (A4 quer) mit **allen** Mitarbeitern zum Abheften – im Aufbau der bisherigen
Word-Tabelle des Büros: Zeilen = Tage (Mo–Fr einzeln, Sa/So zusammen), Spalten = Mitarbeiter
(4 je Seite), je Einsatz „Klient Von–Bis" und rechts die Stunden.

## Dateien

| Datei | Zweck |
|---|---|
| `api/_wochenuebersicht.js` | Renderer (Layout, von Karl abgenommen) + `baueWoche()` (Airtable-Records → Blatt) |
| `api/wochenuebersicht.js` | Endpoint `POST /api/wochenuebersicht` (Hook der Airtable-Automation) |
| `tests/wochenuebersicht.test.mjs` | 20 Tests: Fachregeln, Seitenumbruch, Jahreswechsel, Auth, Fehlerpfad |
| `tests/wochendienstplan-abweichung-summe.test.mjs` | 12 Tests: abweichende Ist-Zeit fett, Wochensumme mit Urlaub/Krank, Legende |

## Fachregeln

Die Rechenregeln werden **nicht nachgebaut**, sondern aus dem Stundenzettel übernommen
(`api/_zeitkonto.js`: `termin()`, `vorbei()`; `api/_abrechnung.js`: Abwesenheits-Stunden):

- **Stunden = bestätigte Ist-Zeit**, Rundung im 15-Minuten-Takt wie beim Stundenzettel.
- Vergangener Einsatz **ohne** bestätigte Ist-Zeit → `offen` (steht orange drauf, zählt nicht).
- `Status = Abgesagt` **oder** `Hervorhebung = Storniert` → durchgestrichen, zählt nicht.
- **Urlaub / Gleitzeit / Krank / Abwesend**: eigener Eintrag über den Einsätzen des Tages – aus einer
  Zeile ohne Klient oder (seit 25.11.2026) aus **abgesagten Einsätzen** mit dieser Auswahl; so trägt das
  Büro Krankheit ein (ein Eintrag je Tag und Art, Regel 7 in `api/_zeitkonto.js`). Stunden aus
  „Stunden Urlaub/Gleitzeit": Urlaub und Krank (wenn eingetragen) als Zahl, Gleitzeit in Klammern –
  `(6)`, zählt wie auf dem Stundenzettel nicht –, Abwesend nie. Eine wieder abgesagte Abwesenheitszeile
  (z. B. abgelehnter Urlaub) steht nicht auf dem Blatt.
- **Wochensumme** (seit 25.11.2026): „… Std. bestätigt" bleibt die gearbeitete Zeit. Vom Büro
  eingetragene Stunden für Urlaub und Krank stehen darunter und werden dazugezählt:
  `+ 24 Urlaub = 48 Std.` (nur bei Mitarbeitern mit solchen Stunden).
- **Abweichende Ist-Zeit** (seit 25.11.2026): Hat die Mitarbeiterin eine andere Zeit bestätigt als
  geplant (im 15-Minuten-Takt, z. B. 2 Std. bei 14.45–16.00), steht die Zahl **fett** da – wie auf dem
  Stundenzettel. Die Legende nennt es nur auf Seiten, auf denen es vorkommt („fett = Ist-Zeit weicht
  vom Plan ab"); kommen Abweichung und `*` auf einer Seite vor, hat die Legende zwei Zeilen.
- **„Abrechnen ohne Lohn"** (Ankreuzfeld am Einsatz, seit 23.11.2026): geplante Zeit mit `*` in
  Violett (z. B. `1,25*`), zählt weder zur Summe noch als `offen`; die Legende nennt das `*` nur
  auf Seiten, auf denen es vorkommt. Seit 24.11.2026 auch am **abgesagten** Einsatz mit Haken: Klient
  und Zeit durchgestrichen, die Zahl mit `*` nicht; unter der Summe steht `* abrechnen ohne Lohn: …
  Std.` (das Büro überträgt von diesem Blatt die Stunden der Klienten in die Abrechnung).
  Details: `claude/Abrechnen_ohne_Lohn.md`.
- `Hervorhebung` Neu/Geändert/Zusatz → gelb hinterlegt.
- Zuordnung über **`Pfleger_ID`** (wie `/api/ma-termine` und `api/_dienstplan.js`).
- Spalten: **aktive** Mitarbeiter mit mindestens einer Zeile in der Woche, nach Name sortiert.
  Der Anzeigename ist das Feld `Name` – das Büro pflegt dort bereits die Kurzform („Vorname N.").
- Klient: „Fr./Hr. Nachname", sobald eine Anrede am Besuch verfügbar ist (Lookup `Anrede_Klient`),
  sonst `Patient_Name`. **Heute existiert dieses Lookup nicht** – es wird also der volle Name
  gedruckt. Legt das Büro das Lookup an, greift die Kurzform automatisch.
- Alle Texte laufen durch `pdfText` (`api/_pdftext.js`), damit Sonderzeichen das PDF nie sprengen.

## Endpoint

```
POST /api/wochenuebersicht
Header: X-Hook-Secret: <STUNDENZETTEL_SECRET>   (zeitkonstanter Vergleich)
Body:   { "recordId": "rec…" }
```

Liest die Zeile der Tabelle **Wochendienstplan**, bestimmt die Woche aus deren Feld `Woche`
(Datum; **leer = laufende Woche**), erzeugt das PDF, hängt es an `Datei` (frühere Fassungen
bleiben erhalten, die neue steht vorne) und setzt `Titel`, `Stand`, `Status = Erstellt`.

- Dateiname: `Wochendienstplan_2026-KW46.pdf`
- Fehler → `Status = Fehler` + `reportError`; Airtable-Überlast (429) → 503
- Die Antwort enthält **nur Status** (`{ status, kw, jahr, mitarbeiter, seiten }`), nie Plandaten.
  Druck-/Schlüsselfelder werden nirgends ausgeliefert.

## Erwartete Felder der Tabelle „Wochendienstplan"

| Feld | Typ | Zweck |
|---|---|---|
| `Woche` | Date | Beliebiger Tag der gewünschten Woche. **Leer = laufende Woche.** |
| `Status` | Single Select | Optionen **`Erstellen`**, **`Erstellt`**, **`Fehler`** (wie beim Stundenzettel) |
| `Datei` | Attachment | Hier landet das PDF; frühere Fassungen bleiben erhalten |
| `Titel` | Single line text | wird gesetzt: „Wochendienstplan KW 46/2026" |
| `Stand` | Single line text | wird gesetzt: Datum + Uhrzeit der Erzeugung (Berliner Zeit) |

Genutzte Felder der Tabelle **Besuche**: `Datum`, `Von`, `Bis`, `Uhrzeit`, `Dauer_Soll`,
`Dauer_Ist`, `Ist_Stunden_Monat`, `Status`, `Hervorhebung`, `Patient_Name`, `Pfleger_ID`,
`Abwesend/Urlaub`, `Stunden Urlaub/Gleitzeit`; optional `Abrechnen ohne Lohn` (fehlt die Spalte,
entsteht das Blatt ohne die Markierung und der Betreiber wird alarmiert).
Aus **Personal**: `Name`, `Aktiv`.

## Noch offen (nicht Teil dieses Branches)

Tabelle, Interface-Seite und die beiden Automationen (Sonntag 20:00 Zeile anlegen;
`Status = Erstellen` → Webhook; Mail „Wochendienstplan fertig" an app@) legt Claude im Chat an.
