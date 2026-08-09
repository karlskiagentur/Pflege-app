# Sicherheits- & Bug-Audit — Wunschlos Pflege-Portal

**Datum:** 2026-08-09 · **Branch:** `audit/bestandsaufnahme` · **Scope:** nur Analyse, keine Funktionsänderung.

Untersucht wurden alle **getrackten** Endpunkte unter `/api` (Stand `main`) sowie der Lohn-/Kontakte-Datenfluss in `src/App.tsx`. Untracked-Altdateien (`app-daten.js`, `login.js`, `push-abo.js`, `termin-*.js`, `aufgabe-umschalten.js`, `dokument-upload.js`) sind **nicht** Teil des Repos/Deploys und wurden nur als Housekeeping-Hinweis vermerkt.

## Gesamtbild

Die Kern-App ist überwiegend **sauber gehärtet**: Klienten-/Mitarbeiter-Endpunkte nutzen konsequent `requireAuth`/`requireMitarbeiter` + `ownOr403` (IDOR-Schutz), `esc()` gegen Formel-Injection, strikte Input-Validierung bei Logins, Rate-Limit/Lockout, SSRF-Allowlist im Download, und `sendError` (kein Airtable-Detail an den Client). Die Auffälligkeiten konzentrieren sich auf **drei ältere Push-Endpunkte ohne Auth**, einen **Login-Aktiv-Check, der ins Leere läuft**, und **zu viel Rückgabe im `app-data`-Payload**.

## Befundübersicht

| # | Schwere | Bereich | Datei:Zeile | Kurzbefund |
|---|---------|---------|-------------|------------|
| F1 | **hoch** | Auth / Zugriffskontrolle | `api/ma-login.js:27` | „Nur aktive Mitarbeiter"-Prüfung wirkungslos → deaktivierte MA können sich einloggen |
| F2 | **mittel** | Auth (fehlend) | `api/send-push-pfleger.js:10-23` | Kein Auth; `mitarbeiterId` ungeprüft in Airtable-URL → Fremd-Push an beliebige MA + Record-Enumeration |
| F3 | **mittel** | Auth (fehlend) | `api/push-event.js:90-205` | Kein Secret/Token; `type:'mitteilung'` hat kein Re-Send-Gate → Rebroadcast an alle auslösbar |
| F4 | **mittel** | Auth (fail-open) | `api/send-push.js:28-34` | Offener Broadcast-Relay, nur geschützt wenn `PUSH_RELAY_SECRET` gesetzt ist |
| F5 | **mittel** | Datenexposition | `api/app-data.js:17,45` | Kompletter Patient-Record inkl. `Session_Token` + `Login_Code` (PIN) im Response |
| F6 | niedrig | Fehler-Reporting | `api/push-event.js:234-238`, `api/send-push-pfleger.js:77` | Roh-`e.message` an Client + kein `reportError` (umgeht die Alarm-/No-Leak-Konvention) |
| F7 | niedrig | Log-Hygiene | `api/send-push.js:58` | Voller `webpush`-Fehler geloggt (kann Abo-Endpoint-URL enthalten) |
| F8 | niedrig | DoS | `api/upload-document.js:18` | Kein Größenlimit auf `fileBase64` (nur Airtable-seitiges Limit) |
| F9 | niedrig | Privacy | `api/app-data.js:9` | Token per Query-String erlaubt (`readToken`) → kann in Logs/Referrer landen |
| F10 | niedrig | Housekeeping | Working-Dir | Obsolete untracked Duplikat-Endpunkte lokal vorhanden (nicht deployt, aber verwechselbar) |

---

## 1) Endpunkte unter `/api`: Auth, Validierung, Fehler-Reporting, kein Leak

**Sauber (Auth + Validierung + `sendError`):**
`app-data.js` (Token), `mark-seen.js`, `update-task.js`, `service-submit.js`, `upload-document.js` (alle `requireAuth` + `ownOr403`); `besuch-dauer.js`, `meldung-senden.js`, `urlaub-antrag.js`, `urlaub-liste.js`, `lohn-liste.js`, `abo-pfleger.js`, `save-subscription.js` (`requireMitarbeiter`/Token); `sign-document.js` (`ownOr403` + Format-Guard); `stundenzettel.js` (`X-Hook-Secret`), `stundenzettel-monatslauf.js` (`CRON_SECRET`). Logins (`patient-login.js`, `ma-login.js`) validieren Eingaben streng (Ziffern/`[A-Z0-9]`), nutzen `esc()`, Lockout nach 5 Fehlversuchen, Token-Rotation, generische Fehlermeldungen (keine Enumeration).

**Abweichungen:**

- **F1 (hoch) — `api/ma-login.js:27`**: `if (f.Aktiv === false)`. Airtable liefert eine **nicht angehakte** Checkbox nicht als `false`, sondern **gar nicht** (`undefined`). `undefined === false` ist `false` → die Sperre greift nie. **Deaktivierte Mitarbeiter können sich weiterhin einloggen.** Fix: `if (!f.Aktiv)`.

- **F2 (mittel) — `api/send-push-pfleger.js:10-23`**: Kein `requireMitarbeiter`/Secret. `mitarbeiterId` aus dem Body geht **ungeprüft** (keine `^rec[A-Za-z0-9]{14,}$`-Prüfung) direkt in die Airtable-URL. Folge: Jeder kann Push-Nachrichten (`titel`/`nachricht`) an eine beliebige/erratene Personal-ID senden; 404-vs-Treffer erlaubt Record-Enumeration.

- **F3 (mittel) — `api/push-event.js:90-205`**: Kein Secret/Token (im Gegensatz zu `stundenzettel.js`). Für `type:'besuch'`/`'dokument'` schützt das `Push_senden='Senden'`-Gate; **`type:'mitteilung'` hat jedoch kein Re-Send-Gate** (`api/push-event.js:167-201`) → wer eine `recordId` kennt/errät, kann eine Mitteilung erneut an alle Klienten/MA broadcasten. Record-IDs sind 17-stellig zufällig (praktisch schwer zu raten), daher „mittel", nicht „hoch".

- **F4 (mittel) — `api/send-push.js:28-34`**: Broadcast-Relay, der **nur** dann geschützt ist, wenn `PUSH_RELAY_SECRET` gesetzt ist (fail-open). Ohne die Env kann der Endpunkt als fremder Push-Versender über die VAPID-Identität der App missbraucht werden. Nicht im Frontend referenziert (mögliche Altlast, s. F10).

- **F6 (niedrig) — `api/push-event.js:234-238`, `api/send-push-pfleger.js:77`**: Beide geben im Catch **`String(e.message)` an den Client** zurück und rufen **kein** `reportError`. Das umgeht die Projekt-Konvention (kein Detail-Leak + Alarm-Mail). `send-push.js` antwortet immerhin generisch, alarmiert aber ebenfalls nicht.

---

## 2) Write-Paths auf aktuell gültige Feldnamen — **OK**

Alle geprüften Schreibpfade verwenden die gültigen Feldnamen; **keine** veralteten `Dauer`-Writes gefunden:

- `besuch-dauer.js:45` → `Dauer_Ist` (Sekunden) ✓
- `stundenzettel.js` liest `Dauer_Ist`, `Ist_Stunden_Monat`, `Von`, `Bis`, `Dauer_Soll` ✓
- `urlaub-antrag.js:28-29` → `Von`, `Bis` (Tabelle Mitarbeiter_Urlaub, Datum) ✓
- `meldung-senden.js`, `service-submit.js` → `Status`, `Notiz_Patient`, `Art`, `Betreff`, `Einsatz`, `Patient` ✓

Kein Write auf das stillgelegte `Dauer_Ist_alt_ungenutzt` und keine bare-`Dauer`-Felder. **Keine Abweichung.**

---

## 3) Kontakte pro Patient/Session gefiltert — **OK**

Es gibt **keinen** eigenständigen Kontakte-Endpunkt; Kontakte kommen ausschließlich über `api/app-data.js`. Der Abruf ist auf den eingeloggten Klienten gefiltert:

- `api/app-data.js:34` baut `byPatient = FIND('<patient.id>', ARRAYJOIN({PatientID_live}))`.
- `api/app-data.js:40` lädt `KONTAKTE` mit **genau diesem** Filter (Kommentar dokumentiert die frühere Behebung eines Leaks „alle Kontakte aller Patienten").

**Kein Leak fremder Kontakte.**

---

## 4) `push-event` & `send-push*`: Empfänger, Payload-Hygiene, abgelaufene Abos

- **Empfänger korrekt:** `push-event.js` sendet bei `type:'besuch'` an Klient **und** zugeteilten Mitarbeiter (`Pfleger`/`Pfleger_ID` → Personal-Abo); Zustellungen sind unabhängig (`sendToAll` je Abo einzeln).
- **Keine PINs/Token in Payload:** Push-Body enthält nur Tätigkeit/Zeit bzw. Mitteilungstext; Info-Kopie ans Büro enthält denselben Klartext, **keine** PINs/Token. Logs kürzen den Abo-Endpoint (`kurzEndpoint`, letzte 12 Zeichen), loggen **nicht** das ganze Abo.
- **Abgelaufene Abos toleriert:** `push-event.js` fängt 404/410 pro Abo ab (kein Abbruch); `send-push-pfleger.js:57-68` **entfernt** abgelaufene Abos aktiv aus Airtable.
- **Einschränkungen:** F2/F3/F4 (fehlende Auth, s. o.). Zusätzlich **F7 (niedrig, `send-push.js:58`)**: der volle `webpush`-Fehler wird geloggt und kann die Abo-Endpoint-URL enthalten (kein PII, aber vermeidbar).
- **Hinweis:** `send-push.js` und `send-push-pfleger.js` werden im Frontend **nicht** referenziert und wirken wie Altlasten aus der n8n-Ära — evtl. rufen Airtable-Automation-Skripte sie aber noch auf. **Vor dem Entfernen prüfen**, dann als Angriffsfläche eliminieren.

---

## 5) `lohn-liste`: keine Stundenzettel-URL (Feld „Datei") mehr — **OK**

`api/lohn-liste.js:20-38` liest **ausschließlich** das Feld `Lohnabrechnung` und gibt pro Zeile `{ id, monat, summe, lohnabrechnung:{name,url} }` zurück. Das Feld **`Datei`** (interner Stundenzettel) wird **nicht** gelesen und **nicht** ausgeliefert; Zeilen ohne Lohnabrechnung-Anhang werden herausgefiltert (`api/lohn-liste.js:35`). `src/App.tsx` zeigt entsprechend nur den Lohnabrechnungs-Button. **Kein Datei-URL-Leak.**

---

## 6) Generischer Scan: ungefangene Fehler, Crash-Risiken, TODO/FIXME

- **try/catch-Abdeckung:** Alle Handler kapseln die Airtable-Arbeit in `try/catch`. Fire-and-forget-Nebenpfade sind bewusst mit `.catch(()=>…)`/innerem `try` abgesichert (`app-data.js:23-32` Zuletzt_aktiv, `send-push-pfleger.js` Abo-Cleanup). `sendAlert`/`reportError` sind selbst „wirft nie".
- **Array-vs-Objekt bei leeren Feldern:** durchgängig defensiv (`(f.X || [])[0]`, `Array.isArray(...) ? ... : ...`, Helfer `val/txt/firstLink` in `push-event.js`). Alle `JSON.parse` (Push-Abos) liegen in `try/catch`. **Kein akutes Crash-Risiko gefunden.**
- **F5 (mittel) — `api/app-data.js:17,45`:** Die Patienten-Abfrage schränkt die Felder **nicht** ein und der **komplette** Record wird als `patienten_daten` zurückgegeben — inklusive `Session_Token`, `Login_Code` (**PIN**), `Failed_Attempts`, `Locked_Until`. Es sind die **eigenen** Daten des Klienten (kein Fremd-Leak), aber PIN/Token gehören nicht in den Datenpayload (Cache/DevTools/Logs). Empfehlung: Feld-Whitelist beim Rückgabe-Mapping.
- **F8 (niedrig) — `api/upload-document.js:18`:** Nur `!fileBase64`-Check, **kein** Größenlimit → große Bodies können Speicher/Function belasten (Airtable begrenzt erst nachgelagert).
- **F9 (niedrig) — `api/app-data.js:9`:** `readToken` akzeptiert den Token auch aus der Query; bei GET landet er dann in URL/Logs/Referrer. Header ist bevorzugt, Query bleibt Alt-Kompatibilität.
- **F10 (niedrig) — Working-Dir:** Obsolete, **untracked** Duplikate (`app-daten.js`, `login.js`, `push-abo.js`, `termin-*.js`, `aufgabe-umschalten.js`, `dokument-upload.js`) liegen lokal. Nicht im Git/Deploy, aber verwechslungsanfällig (der gültige Endpoint ist z. B. `app-data.js`). Aufräumen empfohlen.
- **TODO/FIXME/HACK:** **keine** im Quellcode (`api/*.js`, `src/`).

---

## Empfohlene Reihenfolge der Behebung (separate Aufträge, nicht Teil dieses Audits)

1. **F1** (`ma-login.js:27` → `if (!f.Aktiv)`) — Einzeiler, größter Sicherheitsgewinn.
2. **F2/F3/F4** — Auth für die drei Push-Endpunkte nachziehen (Secret/`requireMitarbeiter`) oder ungenutzte entfernen; `recId`-Regex in `send-push-pfleger`.
3. **F5** — Feld-Whitelist in `app-data` (PIN/Token nicht ausliefern).
4. **F6** — `push-event`/`send-push-pfleger` auf `sendError`/`reportError` umstellen.
5. **F7–F10** — Log-Hygiene, Upload-Limit, Query-Token, Aufräumen.

*Dieses Dokument ist reine Bestandsaufnahme. Es wurde außer dieser Datei nichts geändert.*
