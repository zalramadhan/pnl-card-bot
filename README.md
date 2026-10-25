# 0XGAROU — PnL Card Bot

Bot Telegram yang membuat kartu PnL gaya struk untuk posisi LP.
Data diisi lewat wizard bertombol, dihitung sekali, lalu disimpan sebagai snapshot
immutable beserta PNG-nya. Kartu lama selalu bisa dikirim ulang dengan byte yang sama.

## Yang berbeda dari spec awal

- Baris **Fees & Gas dihapus**.
- **Chart harga dihilangkan** seluruhnya, jadi footer menjadi elemen terakhir.
- **Contract tidak ditampilkan** di kartu (langkah inputnya juga tidak ada).
- Tinggi kartu mengikuti konten (1080 × 1085 px untuk angka normal), bukan dipaksa 1350 px.
- Judul kartu memakai **nama user** (username Telegram, bisa diganti `/setname`).
- Posisi bisa **Closed** atau **Still Open**; yang open memakai label `UNREALIZED`
  dan menyembunyikan baris `Exit MCAP`.
- Range memakai tombol yang mengikuti sisi posisi (Token / Dual / USDG / SOL).

## Setup

```bash
npm install
npm run fonts          # unduh JetBrains Mono ke assets/fonts (sekali saja)
cp .env.example .env   # isi TELEGRAM_BOT_TOKEN
npm run dev
```

Node 20+. Tidak butuh API key apa pun; kurs USD/IDR diambil sekali dari
`open.er-api.com` saat kartu dibuat, lalu disimpan di snapshot.

## Menu utama

`/start` langsung menampilkan keyboard menu yang menetap di bawah layar:

```
🧾 Buat Kartu      📅 Profit Calendar
📜 History         🏷️ Ganti Nama
🧪 Contoh Kartu    ❌ Batal
```

Tombol menu bisa ditekan kapan saja dan tetap berfungsi walau ada wizard berjalan
(menekan “Buat Kartu” memulai wizard baru). **❌ Batal** selalu minta konfirmasi
dulu — pilih `✅ Ya, batalkan` atau `↩️ Lanjutkan` — jadi progres tidak hilang
karena salah tekan.

## Perintah bot

| Command | Fungsi |
|---|---|
| `/newpnl` | Wizard: pair → close reason → DEX → status → entry MCAP → exit MCAP (hanya closed) → initial → received → duration → side → strategy → range |
| `/setname` | Lihat/ganti nama brand di judul kartu (`/setname Budi`), atau kembali ke nama Telegram dengan `/setname reset` |
| `/calendar` | Profit calendar bulanan: tampilan Bulan → Minggu → Hari, tombol navigasi inline |
| `/history` | Kirim ulang 5 kartu terakhir (dari PNG tersimpan) |
| `/demo` | Contoh kartu tanpa mengisi data |
| `/help` | Panduan tiap command, tombol menu, dan pilihan di wizard |
| `/cancel` | Batalkan wizard (dengan konfirmasi) |

Pilihan tombol:

- **Close reason**: Manual, Auto TP, OOR TP, Cut Loss, Stop Loss, OOR LEFT
  (boleh juga ketik alasan lain).
- **DEX**: Meteora, Robinhood.
- **Status**: Closed, Still Open.
- **Side**: Token (range +10%…+90%), Dual (±10%…±90%), USDG & SOL (-10%…-90%).
- **Range custom**: tombol `✏️ Custom` menerima input bebas seperti `-10% to -20%`
  atau `+15%` (tanda `%` yang hilang ditambahkan otomatis).
- **Strategy**: Spot, Curve, Bid/Ask.

Nilai yang tidak diketahui dikirim sebagai `-` (misal MCAP tidak tersedia) dan
akan tampil sebagai `N/A` di kartu, bukan `0`.

## Profit Calendar

`/calendar` atau tombol **📅 Profit Calendar** mengirim gambar 1080 × 1350 berisi
rekap profit dari posisi **Closed** saja, memakai gaya struk yang sama:

- **Bulan** — grid Sen–Min, setiap hari diwarnai hijau/merah sesuai net PnL
  (intensitas mengikuti besar PnL harian), plus kolom total mingguan `Mgg`.
- **Minggu** — bar chart diverging Sen–Min dengan total minggu.
- **Hari** — daftar posisi yang ditutup hari itu: pair, close reason, range,
  durasi, net PnL, dan ROI dari snapshot.

Navigasi lewat inline button: tab `Bulan / Minggu / Hari`, panah `‹ ›`, tombol
`W1…W6` untuk drill-down ke minggu, tombol hari untuk ke hari, dan tombol
`📊 PAIR` untuk mengirim ulang kartu PnL posisi tersebut. Batas navigasi: tidak
bisa melewati hari ini atau sebelum posisi pertama.

Detail data:

- Bucket harian memakai tanggal **close** di `BOT_TIMEZONE` (default WIB).
- Nilai IDR dihitung per posisi dengan kurs yang tersimpan di snapshot masing-masing,
  jadi periode lama tidak berubah saat kurs bergerak.
- Posisi open dan posisi tanpa nilai/rate tidak dihitung; sel yang datanya tidak
  lengkap tampil `N/A`, bukan estimasi.
- Gambar di-cache lewat `file_id` di SQLite; kartu baru otomatis menghapus cache
  milik user itu.

## Render tanpa bot

```bash
npm run demo                     # out/demo-profit.png, demo-loss.png, demo-open.png
npx tsx scripts/calendar-demo.ts # out/calendar-month.png, calendar-week.png, calendar-day.png
```

Atau langsung dari kode:

```ts
import { renderCardPng } from './src/card/render.js';

const png = await renderCardPng(snapshot, { timeZone: 'Asia/Jakarta' });
```

## Deploy & backup

Panduan lengkap VPS + systemd + backup/restore SQLite ada di [`docs/DEPLOY.md`](docs/DEPLOY.md).
Unit systemd siap pakai ada di `deploy/`, dan backup manual bisa dijalankan dengan:

```bash
DB_PATH=./data/pnl.sqlite BACKUP_DIR=./backups npm run backup
```

## Struktur

```
src/card/types.ts    bentuk snapshot (satu-satunya sumber data kartu)
src/card/derive.ts   net PnL = received - initial, ROI dari modal
src/card/format.ts   format USD/IDR, MCAP, durasi, tanggal
src/card/card.ts     snapshot -> view model kartu
src/card/render.ts   satori + resvg -> PNG
src/store.ts         SQLite: snapshot + PNG write-once, dan nama brand per user
src/bot/wizard.ts    alur input bertombol
src/bot/bot.ts       command & callback Telegram
src/calendar/*       agregasi bulan/minggu/hari + renderer kalender
src/bot/calendar.ts  command /calendar, cache file_id, navigasi inline
```

## Aturan data

- Net PnL dan ROI dihitung sekali saat snapshot dibuat, tidak pernah dihitung ulang.
- Nilai IDR memakai kurs yang tersimpan di snapshot; kalau kosong, tampil `N/A`.
- Entry Price dan Exit Price tidak pernah ditampilkan.
- Nama brand ikut disimpan di snapshot, jadi ganti nama tidak mengubah kartu lama.
- Profit dan loss memakai layout identik; hanya warna, tanda, dan angkanya berubah.

## Test

```bash
npm run typecheck
npm test
```
