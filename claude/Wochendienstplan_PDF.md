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

## Fachregeln

Die Rechenregeln werden **nicht nachgebaut**, sondern aus dem Stundenzettel übernommen
(`api/_zeitkonto.js`: `termin()`, `vorbei()`; `api/_abrechnung.js`: Abwesenheits-Stunden):

- **Stunden = bestätigte Ist-Zeit**, Rundung im 15-Minuten-Takt wie beim Stundenzettel.
- Vergangener Einsatz **ohne** bestätigte Ist-Zeit → `offen` (steht orange drauf, zählt nicht).
- `Status = Abgesagt` **oder** `Hervorhebung = Storniert` → durchgestrichen, zählt nicht.
- **Urlaub / Gleitzeit / Krank / Abwesend** (Zeile ohne Klient): eigener Eintrag. Stunden aus
  „Stunden Urlaub/Gleitzeit" nur bei Urlaub und Gleitzeit; Krank/Abwesend nie.
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
`Abwesend/Urlaub`, `Stunden Urlaub/Gleitzeit`.
Aus **Personal**: `Name`, `Aktiv`.

## Noch offen (nicht Teil dieses Branches)

Tabelle, Interface-Seite und die beiden Automationen (Sonntag 20:00 Zeile anlegen;
`Status = Erstellen` → Webhook; Mail „Wochendienstplan fertig" an app@) legt Claude im Chat an.
