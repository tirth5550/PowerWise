# PowerWise – Electricity Usage Predictor

Multi-page website with login, bill upload (OCR), history and an admin panel.

## Kevi rite chalavvu (VS Code)

1. Zip extract karo, pachhi VS Code ma **File -> Open Folder** thi `PowerWise` folder kholo.
2. **Terminal -> New Terminal** kholo ane lakho:

   ```
   python server.py
   ```
   (na chale to `python3 server.py` athva `py server.py`)
3. Terminal ma address aavshe, jem ke `http://127.0.0.1:8080`.
   VS Code ma jovu hoy to: `Ctrl + Shift + P` -> **Simple Browser: Show** -> e address nakho.
4. Server band karva: terminal ma `Ctrl + C`.

Jo juno server (`python -m http.server` ke junu PowerWise) haju chalu hoy to e terminal ma `Ctrl + C` thi band karo.
Windows ma `run.bat` par double-click karva thi pan server chalu thai jay chhe.

**Juna users / data rakhva hoy to:** juna folder ni `data/db.json` file navi `PowerWise/data/` ma copy kari do (server band hoy tyare).

## Login pachhi pehla shu aave chhe

Login karta j **Upload bill** page khule chhe (admin ne Admin page).

1. Bill nu **photo (JPG/PNG) athva PDF** choose karo. Ek saathe ghana mahina na bill pan pasand kari shako.
2. PowerWise **units, bill amount ane billing period** vanchi ne batave chhe. Tame check karo (khoti hoy to sudharo).
3. **Save to history** dabavo. Bill history ma save thai jay chhe.
4. **Predict** page par last 6 mahina na units potanii mele bharai jay chhe. Je mahina no bill upload nathi karyo te j hathe nakhva padse.

Bill tamara browser ma j vanchay chhe, koi server par file upload thati nathi. Fakt units, amount ane period save thay chhe. Bill nu photo save thatu nathi. Offline pan chale (OCR files `public/vendor` ma chhe).

Tip: "Try a sample bill" button thi demo bill par try kari shako. Photo saaf, sidho ane puro bill dekhay tevo levo. Kai na vanchai to "Show the text that was read" jovu ane numbers hathe nakhva.

## Pages

| Page | Shu kare chhe |
|------|----------------|
| `index.html` | Login / Create account (website kholta j pehla aa aave) |
| `bills.html` | **Bill upload (OCR)**: units, amount, billing period vanchi ne save kare. Login pachhi aa aave |
| `predict.html` | past 6 mahina na units thi prediction (bill mathi auto-fill) |
| `appliances.html` | appliances thi usage estimate |
| `tariff.html` | potana slab rates |
| `summary.html` | Badhi calculation ek page par |
| `history.html` | Bills, predictions, appliances, tariff ketli vaar save karya te |
| `admin.html` | Admin: users, logins, website colour |

## Admin

- Username: `admin`
- Password: `admin123`  (**pehla j divase Admin page ma badli nakho**)

Admin page ma: ketla loko registered chhe, ketla login thaya (aaje / total / 7 divas), kon online chhe, darek user ni last login, ane **Website colours** (ready-made looks athva potana colours, Save karo to badha users ne navo colour dekhashe).

## Biji device / bija loko mate

`python server.py --share` chalavo. Terminal ma "Others on your Wi-Fi" no address aavshe. Same Wi-Fi na loko e address kholi ne account banavi shake. Aa mate admin password pehla badli nakho.

## Data kya save thay chhe

`data/db.json` ma (users, passwords hashed, bills, history, colours). Badhu reset karvu hoy to server band karo ane `data/db.json` delete karo.

## Structure

```
PowerWise/
├── server.py        (backend, Python ma j, install ni jarur nathi)
├── run.bat / run.sh
├── data/            (db.json aahin banse)
└── public/
    ├── index.html  bills.html  predict.html  appliances.html  tariff.html
    ├── summary.html  history.html  admin.html
    ├── css/style.css
    ├── js/          (common.js, billparse.js, bills.js + darek page nu js)
    ├── samples/     (demo bill PNG ane PDF)
    └── vendor/      (OCR engine: Tesseract + PDF.js, offline)
```

Prediction simple linear trend par chhe. Tariff rates sample chhe, potana bill mujab badlo.
