# Moving Sale

A tiny static page for a friends-only moving sale. Friends browse by category, see
prices, and tap **Book** (which opens a prefilled Google Form). No backend.

- **Catalog + list prices** live in [`data/items.json`](data/items.json), with an optional
  original retail price and product link per item so cards can show a `64% off` badge.
- **Friend prices** are AES-encrypted in [`data/discounts.enc.json`](data/discounts.enc.json)
  and only decrypt in the browser for someone who opens a **friend link** (`#f=...`).
  A visitor without that link sees no code box, no hint, and no request for the
  encrypted file at all — the page just looks like a plain list-price catalog.
- **Live status** (available / reserved / sold) is read from a **published Google Sheet CSV**
  that you maintain by hand.
- **Bookings** land in that same Google Sheet, where you also track
  confirmed / paid / delivered / delivery date.

---

## One-time setup

### 1. Google Form (booking)

1. Create a Google Form with these questions:
   - **Item** — short answer (this is the field we prefill)
   - **Your name** — short answer
   - **Contact (WeChat / email / phone)** — short answer
   - **Preferred pickup time** — short answer
   - **Note** — paragraph, optional
2. In the Form, **⋮ → Get pre-filled link**, type anything in *Item*, click **Get link**, copy it.
   The link contains `entry.NNNNNNNNN=...` — that number is your **entry id**.
3. The Form's normal share link looks like
   `https://docs.google.com/forms/d/e/XXXX/viewform` — that's your **form base URL**.
4. In the Form: **Responses → Link to Sheets** → create a spreadsheet.

### 2. Google Sheet (status + management)

In that spreadsheet:

1. `Form Responses 1` tab fills itself. Add columns to the right for yourself:
   `confirmed | agreedPrice | paid | delivered | deliveryDate | notes`.
2. Add a second tab named **`Status`** with a header row `id,status,note` and one row per item:

   | id | status | note |
   |----|--------|------|
   | bed-frame | available | |
   | wardrobe | reserved | holding for A |
   | water-dispenser | sold | |

   `status` is one of `available`, `reserved`, `sold`. Anything else is treated as `available`.
   Item ids must match the `id` values in `data/items.json`. See
   [`data/status.sample.csv`](data/status.sample.csv).
3. Publish the `Status` tab: **File → Share → Publish to web**, choose the **Status** sheet,
   format **Comma-separated values (.csv)**, **Publish**. Copy that URL.

> When you confirm or hand over an item, update its row in the `Status` tab.
> The site refreshes on page load; friends can also hit **Refresh**. Google caches the
> published CSV for a few minutes.

### 3. Fill in `data/items.json`

Set the four values in `config`:

```json
"formBaseUrl":   "https://docs.google.com/forms/d/e/XXXX/viewform",
"formItemEntry": "entry.123456789",
"statusCsvUrl":  "https://docs.google.com/spreadsheets/d/e/XXXX/pub?gid=123&single=true&output=csv",
"sellerContact": "WeChat: scarletgzh  ·  Email: solonori.guo@gmail.com"
```

### 4. Friend prices

1. Edit `discounts.plain.json` in the repo root (this file is **gitignored** — it never gets
   committed):

   ```json
   { "bed-frame": 95, "wardrobe": 60, "water-dispenser": 40 }
   ```

2. Encrypt it with your chosen code (pick a 3–4 word passphrase):

   ```bash
   node scripts/encrypt-discounts.mjs "maple street 42"
   ```

   This writes `data/discounts.enc.json`. Commit **only** that file.
   Re-run this whenever you change a friend price.

### 5. Publish

- Push to a **private** GitHub repo.
- **Settings → Pages → Deploy from branch → `main` / root**.
- Public link (list prices only): `https://<user>.github.io/<repo>/`
- Friend link (auto-unlocks): `https://<user>.github.io/<repo>/#f=maple%20street%2042`

Use `#f=` rather than `?code=` — a fragment is never sent to GitHub's servers or leaked
in a `Referer` header. The page strips the code out of the address bar right after
unlocking, and remembers it in `localStorage`, so a friend who returns later still sees
friend prices without the link. `?code=` still works for old links.

**Testing / manual entry:** tap the page title 5 times to get a bare prompt — enter a code
to unlock, or submit it empty to re-lock and see exactly what a stranger sees.

The site sends `noindex` and is only linked where you share it, but note a GitHub Pages
site is technically public — that's why friend prices are encrypted, not just hidden.
Anyone who reads `assets/app.js` can tell that *some* discount mechanism exists; what they
can't do is compute the prices without the code. If even the existence of a friend tier
should be secret, keep the repo private and don't hand out the public link.

---

## Adding / editing items

Edit `data/items.json`. Each item:

```json
{
  "id": "desk-lamp",
  "category": "home",
  "name":  { "zh": "护眼台灯", "en": "Desk lamp" },
  "desc":  { "zh": "可调色温", "en": "Adjustable color temp" },
  "condition": { "zh": "九成新", "en": "Like new" },
  "listPrice": 15,
  "retailPrice": 39,
  "link": "https://www.example.com/the-original-listing",
  "currency": "USD",
  "dimensions": "",
  "images": ["desk-lamp-1.jpg"]
}
```

- `listPrice` is what you're asking. **`retailPrice` and `link` are both optional and
  independent.**
- With `retailPrice`, the card shows a discount badge (`省 64%` / `64% off`) and a small
  `原价 USD 39` line underneath. The percentage is always measured against `retailPrice`,
  so it recalculates on its own when a friend price unlocks. No `retailPrice` → just the
  plain price, no badge, no extra line.
- `link` makes that line clickable (opens in a new tab). Set it without `retailPrice` and
  you get a bare `原价商品链接 ↗` line instead. Anything that isn't an `http(s)://` URL is
  ignored, so a leftover placeholder just won't render.
- A `retailPrice` at or below the current price shows no badge — no accidental "0% off".
- Photos go in `images/`. Reference them by filename. First image is the card thumbnail;
  tap it to enlarge. Missing photo → `placeholder.svg`.
- Categories are defined in the `categories` array of the same file (id + `zh` + `en`).
- Add the item's `id` to the `Status` tab so it shows the right badge.

## Local preview

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. For a full local test you can temporarily point
`statusCsvUrl` at `data/status.sample.csv`.

## Files

| path | what |
|------|------|
| `index.html` / `assets/` | the page |
| `data/items.json` | catalog, categories, list prices, config |
| `data/discounts.enc.json` | encrypted friend prices (committed) |
| `discounts.plain.json` | plaintext friend prices (gitignored, local only) |
| `scripts/encrypt-discounts.mjs` | encrypts the above |
| `data/status.sample.csv` | example of the `Status` tab format |
| `images/` | item photos |
