# ☕ Brew Crew

Een webapp voor Dauwe, Reinoud en Walter om de koffies van [Cross Roast](https://www.crossroast.be/productcategorie/koffiebonen/) bij te houden, te scoren en te ontdekken wat jullie lekker vinden.

## Wat kan de app (versie 1)

| Scherm | Wat |
|---|---|
| **Coffees** | Alle gedronken koffies, met de score van iedereen. Zoeken, filteren (Reorder / Skip / proces) en sorteren. |
| **＋ (Add)** | Plak een Cross Roast-link en alles wordt ingevuld (land, proces, variëteit, hoogte, smaaknoten, foto, verhaal). Plak meerdere links tegelijk voor een hele bestelling. Daarna meteen scoren, 1–10 met halve punten. De laatste score telt. |
| **Taste** | Smaakprofiel van de crew of per persoon: samenvatting in gewone taal, top 10, "niet meer bestellen", smaakkaart, proces, aciditeit/body/zoetheid/bitterheid, smaakfamilies, landen, hoogte, wie het strengst scoort en wie op wie lijkt. |
| **Shop** | Plak een link om te checken of jullie een koffie lekker zouden vinden. Toont ook het huidige aanbod van Cross Roast, gesorteerd op verwachte score, met "Reorder" bij koffies die jullie al goed vonden. |
| **Orders** | Elke bestelling (3–5 koffies) als groep, met datum en notitie. |

Alles werkt **zonder AI en volledig gratis**: de smaakanalyse gebruikt een ingebouwde woordenlijst (bv. "limoen" → citrus → meer aciditeit) en eenvoudige statistiek.

> **Let op:** in versie 1 worden de gegevens op het toestel zelf bewaard. Gebruik de app dus op één gsm (die van Dauwe). Synchroniseren tussen toestellen komt in versie 2.

## Eenmalig online zetten via Cloudflare Pages (±5 minuten)

1. Ga naar [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → tab **Pages** → **Connect to Git**.
2. Kies de GitHub-repository **Coffee** (geef Cloudflare toegang als daarom gevraagd wordt).
3. Instellingen:
   - **Production branch:** de branch met deze code (eerst `claude/amazing-pascal-j3k3gg`, of `main` zodra die samengevoegd is)
   - **Framework preset:** `None`
   - **Build command:** *(leeg laten)*
   - **Build output directory:** `public`
4. Klik **Save and Deploy**. Na ongeveer een minuut krijg je een link zoals `https://brew-crew.pages.dev`.

Elke nieuwe versie die naar GitHub gaat, zet Cloudflare daarna automatisch online.

### Op je iPhone zetten als app
Open de link in **Safari** → deelknop → **Zet op beginscherm**. De app opent dan schermvullend, zonder adresbalk, en start ook zonder internet (alleen het ophalen van nieuwe koffies heeft internet nodig).

### Uitproberen
Ga naar ⚙️ (rechtsboven op Coffees) → **Load demo data**: 14 echte Cross Roast-koffies met verzonnen scores. Met **Remove demo data** verwijder je ze weer; jullie eigen koffies blijven staan.

## Hoe het technisch werkt (voor later)

- `public/`: de app zelf (HTML, CSS en JavaScript, geen build-stap)
- `functions/api/`: twee kleine Cloudflare-functies die de productgegevens van crossroast.be ophalen (de browser mag dat niet rechtstreeks). Ze praten enkel met crossroast.be.
- Lukt de eigen functie niet (bv. lokaal geopend), dan probeert de app automatisch gratis publieke tussendiensten. Lukt ook dat niet, dan kan je een koffie manueel invullen.
- `tests/`: automatische tests (`npm test`); `tools/dev-server.mjs` start een lokale versie (`npm run dev`).

## Ideeën voor versie 2
- Synchroniseren tussen gsm's via Cloudflare D1 (gratis)
- Eigen smaakkenmerken scoren (aciditeit, body …) naast de totaalscore
