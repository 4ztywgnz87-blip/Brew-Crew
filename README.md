# ☕ Brew Crew

Een webapp voor Dauwe, Reinoud en Walter om de koffies van [Cross Roast](https://www.crossroast.be/productcategorie/koffiebonen/) bij te houden, te scoren en te ontdekken wat jullie lekker vinden.

## Wat kan de app (versie 1)

| Scherm | Wat |
|---|---|
| **Coffees** | Alle gedronken koffies, met de score van iedereen. Zoeken, filteren (Reorder / Skip / proces) en sorteren. |
| **＋ (Add)** | Tik de koffies aan die je bestelde, rechtstreeks uit het huidige Cross Roast-aanbod, en alles wordt ingevuld (land, proces, variëteit, hoogte, smaaknoten, foto, verhaal). Staat een koffie niet meer op de site, plak dan de link of vul hem manueel in. Daarna scoren, 1–10 met halve punten. De laatste score telt. |
| **Taste** | Smaakprofiel van de crew of per persoon: samenvatting in gewone taal, top 10, "niet meer bestellen", smaakkaart, proces, aciditeit/body/zoetheid/bitterheid, smaakfamilies, landen, hoogte, wie het strengst scoort en wie op wie lijkt. |
| **Shop** | Plak een link om te checken of jullie een koffie lekker zouden vinden. Toont ook het huidige aanbod van Cross Roast, gesorteerd op verwachte score, met "Reorder" bij koffies die jullie al goed vonden. |
| **Orders** | Elke bestelling (3–5 koffies) als groep, met datum en notitie. |

Alles werkt **zonder AI en volledig gratis**: de smaakanalyse gebruikt een ingebouwde woordenlijst (bv. "limoen" → citrus → meer aciditeit) en eenvoudige statistiek.

> **Let op:** in versie 1 worden de gegevens op het toestel zelf bewaard. Gebruik de app dus op één gsm (die van Dauwe). Synchroniseren tussen toestellen komt in versie 2.

## Online zetten via Cloudflare

De repository bevat een `wrangler.jsonc`. Daarin staat alles wat Cloudflare moet weten, dus je hoeft **niets in te stellen**:

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Import a repository** → kies **Coffee** → **Deploy**.
2. Na ongeveer een minuut krijg je een link zoals `https://coffee.<jouw-naam>.workers.dev`.

Elke nieuwe versie op GitHub zet Cloudflare daarna automatisch online.

*Heb je toch een **Pages**-project gemaakt (link eindigt op `.pages.dev`)?* Ga dan naar het project → **Settings** → **Build** → **Build configuration** → **Edit**, zet **Build output directory** op `public` en kies daarna bij **Deployments** → **Retry deployment**.

### Op je iPhone zetten als app
Open de link in **Safari** → deelknop → **Zet op beginscherm**. De app opent dan schermvullend, zonder adresbalk, en start ook zonder internet (alleen het ophalen van nieuwe koffies heeft internet nodig).

### Uitproberen
Ga naar ⚙️ (rechtsboven op Coffees) → **Load demo data**: 14 echte Cross Roast-koffies met verzonnen scores. Met **Remove demo data** verwijder je ze weer; jullie eigen koffies blijven staan.

## Hoe het technisch werkt (voor later)

- `public/`: de app zelf (HTML, CSS en JavaScript, geen build-stap)
- `src/worker.js` + `functions/api/`: kleine Cloudflare-functies die de productgegevens van crossroast.be ophalen (de browser mag dat niet rechtstreeks). Ze praten enkel met crossroast.be.
- Lukt de eigen functie niet (bv. lokaal geopend), dan probeert de app automatisch gratis publieke tussendiensten. Lukt ook dat niet, dan kan je een koffie manueel invullen.
- `tests/`: automatische tests (`npm test`); `tools/dev-server.mjs` start een lokale versie (`npm run dev`).

## Ideeën voor versie 2
- Synchroniseren tussen gsm's via Cloudflare D1 (gratis)
- Eigen smaakkenmerken scoren (aciditeit, body …) naast de totaalscore
