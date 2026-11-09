# CasinobyHacky

Evidența zilnică a sălilor de joc, cu interfață de aparat de cazino. Pagina e servită la `/casinobyhacky`, iar API-ul la `/casinobyhacky/api/*`.

- **Conturi:** parola nu ajunge niciodată pe server. Browserul derivă o cheie (PBKDF2) și trimite doar un „verifier”, pe care serverul îl păstrează hash-uit.
- **Lista de cazinouri:** e criptată în browser (AES-GCM) și salvată ca text criptat. Serverul nu vede numele sau link-urile.
- **Securitate:** sesiunile durează 30 de zile, iar contul se blochează 15 minute după 10 parole greșite.

## Structură

| Cale | Ce conține |
| --- | --- |
| `casinobyhacky/index.html` | Pagina completă (stiluri și script incluse) |
| `src/api.ts` | API: `salt`, `register`, `login`, `logout`, `vault` |
| `src/db.ts` | Clientul Supabase (service role) |
| `api/[...path].ts` | Funcția Vercel care servește API-ul |
| `supabase/migrations/0001_casinobyhacky.sql` | Tabelele `casinobyhacky_accounts`, `casinobyhacky_sessions`, `casinobyhacky_vaults` |
| `tests/api.test.ts` | Teste pentru API |

## Punere în funcțiune

1. **Baza de date:** într-un proiect Supabase, rulează `supabase/migrations/0001_casinobyhacky.sql` în SQL Editor. Poate fi proiectul AutoCore sau unul separat, pentru că tabelele au prefixul `casinobyhacky_` și nu ating nimic altceva.
2. **Vercel:** importă acest repo ca proiect nou (fără build command; Vercel detectează funcția din `api/`). Adaugă variabilele de mediu:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. **Test:** deschide `https://<proiect>.vercel.app/casinobyhacky` și fă un cont.
4. **auto-core.ro/casinobyhacky:** în proiectul AutoCore setează variabila `CASINOBYHACKY_ORIGIN` la adresa de la pasul 3 (de ex. `https://casinobyhacky.vercel.app`). AutoCore trimite mai departe `/casinobyhacky` și `/casinobyhacky/api/*` către CasinobyHacky.

## Local

```bash
npm install
cp .env.example .env   # completează cheile Supabase, apoi exportă-le în shell
npm run dev            # http://localhost:3000/casinobyhacky
npm test
```
