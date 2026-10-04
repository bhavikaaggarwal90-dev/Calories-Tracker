# Panel

A private calorie and macro log. Four ways to add food — search, barcode, photo, manual — and a weight trend. No account, no server, no tracking. Everything you log stays in your own browser.

---

## Put it online

1. Create a new repository on GitHub. Call it `panel` (any name works).
2. Upload every file in this folder to the **root** of the repository — not inside a subfolder.
3. Go to **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**. Save.
4. Wait a minute, then open `https://YOUR-USERNAME.github.io/panel/`.

On a free GitHub account, Pages only works from a public repository. That's fine here — the repository contains the app, never your data. Your food log, your weight, and your API key live in your browser's storage and are never uploaded anywhere.

## Install it on your phone

Open the URL on your phone, then:

- **iPhone** — Share button → *Add to Home Screen*
- **Android** — menu → *Install app*

It then opens full-screen like a normal app and works offline.

---

## The four ways to add food

### Search
Types into your local database first — about 130 staples, French and Indian, in `foods.json` — then queries [Open Food Facts](https://world.openfoodfacts.org) for packaged products. Free, open, no key, unlimited.

### Barcode
Point the camera at a barcode and it looks the product up on Open Food Facts.

The camera path uses the browser's `BarcodeDetector`, which works in **Chrome and Edge on Android and desktop** but **not in Safari or on iOS**. On iOS the *type the number* box does the same job — the digits are printed under every barcode.

If a product isn't in Open Food Facts, add it once manually with *Keep in my foods* ticked and it's yours forever.

### Photo
This is the CalAI-style feature, and the one thing that isn't free.

A photo has to be read by a vision model, and a static site has no server to hide a key behind. So the app asks for **your own** API key and keeps it in your browser only — it is never in the repository and never sent anywhere except to the provider you chose.

To set it up: **Settings → Photo scanning**, pick Anthropic or OpenAI, paste your key, save.

- Anthropic keys: <https://console.anthropic.com> → API keys. Default model `claude-sonnet-5`.
- OpenAI keys: <https://platform.openai.com> → API keys. Default model `gpt-4o-mini`.

Roughly one to two cents a photo. Put a low monthly spend cap on the key in your provider's console and you can't be surprised.

Estimates get noticeably better when something of known size is in frame — a fork, your hand, a standard glass. There's a notes box for anything the camera can't see, like the tablespoon of ghee it was cooked in.

Treat the numbers as an estimate. Weighing is more accurate; photos are for when weighing isn't going to happen.

### Manual
Name, four numbers, per 100 g or per portion. Tick *Keep in my foods* and it joins your search results.

---

## Your meal plan

`plan.json` holds the three-week plan: 39 ingredients and 16 meals, with your own numbers — your loaf, your whey scoop, the full Herbalife shake, raw chicken weights, the dahi tadka sandwich, every snack.

**Settings → Your meal plan → Load plan** copies all of it into your own editable lists. Run it once. It only adds what's missing, so running it again after you've changed things leaves your edits alone. **Reset plan items to original** puts the plan's own numbers back, and never touches foods or meals you created yourself.

After loading, the ingredients appear in search tagged *Yours* and the meals appear as chips at the top of the add sheet — one tap logs the whole breakfast.

### Editing

Everything is editable in place, under Settings:

- **My foods** — tap one to change its name, its four numbers, whether they're per 100 g or per portion, and the portions it offers (*1 scoop*, *200 g raw*, *1 slice*). Editing a food also updates every saved meal that contains it, so correcting your whey label once fixes the shake everywhere.
- **Saved meals** — tap one to rename it, change any quantity, remove a line, or add a food. Running totals update as you type.

When you type numbers into a food, the editor checks them against each other: if protein, carbs and fat don't multiply out to roughly the calories you entered, it says so. Fibre and alcohol cause small gaps; a large one is nearly always a typo.

## Making new repeat meals

On the Today screen, any meal with food in it shows a small **save as…** next to its calorie count. Eat something, adjust the portions until they're right, save it, and it joins the chips.

---

## Your numbers

Targets come from Mifflin–St Jeor: resting metabolic rate from your height, weight, age and sex, multiplied by your activity level, adjusted for your goal. Protein is set at 1.8 g per kg of bodyweight, fat at about 27% of calories, carbohydrate takes the remainder.

The calorie target will never be set below your resting metabolic rate, or below 1200 (1500 for men), whichever is higher. Eating under that for any length of time tends to cost you muscle and adherence rather than fat.

Override any of the four numbers in Settings if a coach or dietitian has given you different ones. *Recalculate from my stats* puts the formula back in charge.

Logging today's weight also updates the weight used in the calculation, unless you've set custom targets.

---

## Backups

Browser storage is durable but not permanent — clearing site data clears your log, and a new phone starts empty.

**Settings → Export backup** downloads a JSON file with everything in it. **Import backup** restores it, on any device. **Export CSV** gives you every logged item as a spreadsheet if you'd rather do your own analysis.

Worth doing once a month.

---

## Adding to the food database

`foods.json` is a plain list. Add entries, commit, done:

```json
{
  "n": "Idli sambar",
  "g": "Cooked dishes",
  "k": 110,
  "pr": 4,
  "cb": 20,
  "ft": 1.5,
  "u": [{ "l": "1 plate", "g": 250 }]
}
```

- `n` name, `g` group, `k` calories, `pr` protein, `cb` carbs, `ft` fat — **all per 100 g**
- `u` is optional: portions you'd rather count than weigh, each with its weight in grams

After editing, bump `const CACHE = 'panel-v1'` in `sw.js` to `panel-v2` so installed copies pick up the change.

---

## Files

| | |
|---|---|
| `index.html` | structure |
| `styles.css` | the look — a nutrition-label visual language |
| `app.js` | all logic |
| `foods.json` | the general food database |
| `plan.json` | your meal-plan ingredients and meals |
| `sw.js` | offline caching |
| `manifest.webmanifest`, `icon-*` | makes it installable |

No build step, no dependencies, no npm. Edit a file, commit, refresh.

---

## A note on the numbers

This is a logging tool, not medical advice. Calorie and macro figures — yours and any database's — are estimates with real error bars. If you have a health condition, are pregnant, or have any history of disordered eating, talk to a doctor or a registered dietitian before working to a calorie target.
