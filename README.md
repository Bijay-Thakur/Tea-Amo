# TEA AMO

Cafe operating system for Tea Amo. The owner point of sale runs on the cafe laptop. Staff take table orders from phones on the same Wi-Fi.

## Start

1. Install [Node.js](https://nodejs.org/) LTS.
2. Double-click `RUN_TEA_AMO_SERVER.bat`.
3. The owner screen opens at [http://127.0.0.1:8787](http://127.0.0.1:8787).

From a terminal, the same start is:

```bash
node server.js
```

The server prints the staff address, for example `http://192.168.1.214:8787/staff`. Phones must be on the cafe Wi-Fi. The owner screen is only available on this laptop.

Set `TEA_AMO_PORT` if 8787 is already in use.

## What it covers

- Floor-plan POS, counter orders, split bills, mixed payments, and receipts
- Menu, recipes, kitchen and bar inventory, wastage, and vendors
- Staff, attendance, and phone ordering with a PIN
- Expenses, owner cash, and the daily business report
- Sales charts, item sales, and backup or restore from Settings

## Layout

```
server.js                 Local server and saved-data API
RUN_TEA_AMO_SERVER.bat    Windows start
master-state.json         Cafe records: menu, bills, stock, staff
lan-state.json            Live table orders shared with staff phones
public/owner/             Owner screens
public/staff.html         Staff phone page
public/styles/            Layout and ink-and-paper theme
public/js/                Catalog, owner logic, staff logic, shared UI
public/assets/            Logo, favicon, and floor plan
```

`master-state.json` and `lan-state.json` are the working data. Do not delete them.
