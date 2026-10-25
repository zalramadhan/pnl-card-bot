# Deploy ke VPS (systemd) + Backup SQLite

Panduan ini mengasumsikan Ubuntu 22.04/24.04, satu VPS kecil (1 vCPU, 1 GB RAM cukup),
dan bot dijalankan dengan long polling — **tidak perlu buka port masuk**, hanya
outbound HTTPS ke `api.telegram.org` dan endpoint kurs.

Hasil akhir di server:

```
/opt/pnl-card-bot/                 kode + node_modules + assets/fonts
/etc/pnl-card-bot.env              token & konfigurasi (0640 root:pnlbot)
/var/lib/pnl-card-bot/pnl.sqlite   database (dibuat oleh systemd StateDirectory)
/var/backups/pnl-card-bot/         hasil backup harian
```

---

## 1. Prasyarat

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates git build-essential python3
```

`build-essential` + `python3` hanya dipakai kalau better-sqlite3 tidak punya
prebuilt binary untuk versi Node di server.

## 2. User & direktori

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin pnlbot
sudo install -d -o pnlbot -g pnlbot /opt/pnl-card-bot
sudo install -d -o pnlbot -g pnlbot -m 0750 /var/backups/pnl-card-bot
```

`/var/lib/pnl-card-bot` tidak perlu dibuat manual: unit systemd memakai
`StateDirectory=pnl-card-bot`, jadi systemd yang membuat dan mengatur pemiliknya.

## 3. Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # harus >= 20, disarankan 22 atau 24
```

Jangan pakai paket `nodejs` bawaan Ubuntu 22.04 (Node 12) atau 24.04 (Node 18).

## 4. Upload kode

Dari laptop (sesuaikan host):

```bash
rsync -av --delete \
  --exclude node_modules --exclude data --exclude out --exclude .env \
  ./ pnlbot@<IP-VPS>:/opt/pnl-card-bot/
```

Atau di server, kalau repo sudah punya remote:

```bash
sudo -u pnlbot git clone <URL-REPO> /opt/pnl-card-bot
```

Font JetBrains Mono sudah ikut di `assets/fonts/`. Kalau folder itu kosong:

```bash
sudo -u pnlbot bash -c 'cd /opt/pnl-card-bot && npm run fonts'
```

## 5. Install dependency

```bash
sudo -u pnlbot bash -c 'cd /opt/pnl-card-bot && npm ci --omit=dev'
```

- `tsx` ada di `dependencies`, jadi bot tetap bisa jalan tanpa devDependency.
- Kalau npm memblokir install script native (npm 12+):
  `sudo -u pnlbot bash -c 'cd /opt/pnl-card-bot && npm install-scripts approve better-sqlite3 esbuild'`.
- Kalau muncul `Could not locate the bindings file`:
  `sudo -u pnlbot bash -c 'cd /opt/pnl-card-bot && npm rebuild better-sqlite3'`.

## 6. File environment

```bash
sudo tee /etc/pnl-card-bot.env >/dev/null <<'EOF'
TELEGRAM_BOT_TOKEN=123456789:ISI_TOKEN_DARI_BOTFATHER
DEFAULT_CURRENCY=IDR
BOT_TIMEZONE=Asia/Jakarta
DB_PATH=/var/lib/pnl-card-bot/pnl.sqlite
BACKUP_DIR=/var/backups/pnl-card-bot
BACKUP_KEEP_DAYS=14
EOF

sudo chown root:pnlbot /etc/pnl-card-bot.env
sudo chmod 640 /etc/pnl-card-bot.env
```

`DEFAULT_CURRENCY` hanya `USD` atau `IDR`. `BACKUP_*` hanya dipakai script backup.

## 7. Uji manual sebelum systemd

```bash
sudo -u pnlbot bash -c '
  set -a; . /etc/pnl-card-bot.env; set +a
  cd /opt/pnl-card-bot
  node node_modules/tsx/dist/cli.mjs src/index.ts
'
```

Harus muncul `@namabot siap · currency IDR · timezone Asia/Jakarta`.
Coba `/newpnl` di Telegram, lalu `Ctrl+C`. Database akan ada di
`/var/lib/pnl-card-bot/pnl.sqlite` (kalau folder itu belum ada, buat dulu:
`sudo install -d -o pnlbot -g pnlbot /var/lib/pnl-card-bot`).

## 8. Pasang service systemd

```bash
sudo cp /opt/pnl-card-bot/deploy/pnl-card-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pnl-card-bot
sudo systemctl status pnl-card-bot --no-pager
sudo journalctl -u pnl-card-bot -f
```

Perintah harian:

```bash
sudo systemctl restart pnl-card-bot     # setelah update / ubah env
sudo systemctl stop pnl-card-bot
sudo journalctl -u pnl-card-bot -n 100 --no-pager
```

Unit sudah memakai `Restart=always`, jadi bot hidup lagi setelah crash atau reboot.
`ProtectSystem=strict` membuat filesystem read-only kecuali `StateDirectory`
(`/var/lib/pnl-card-bot`). Kalau kamu memindahkan `DB_PATH` ke luar folder itu,
tambahkan `ReadWritePaths=/path/baru` di unit.

### Update kode

```bash
sudo -u pnlbot git -C /opt/pnl-card-bot pull --ff-only
sudo -u pnlbot bash -c 'cd /opt/pnl-card-bot && npm ci --omit=dev'
sudo systemctl restart pnl-card-bot
```

Kartu yang sudah tersimpan tidak berubah setelah update: snapshot + PNG tersimpan di database.

---

## 9. Backup database SQLite

### Kenapa tidak boleh `cp pnl.sqlite`

Database berjalan dengan **WAL**. Menyalin file `.sqlite` saja bisa kehilangan
transaksi yang masih di `pnl.sqlite-wal`, atau menyalin saat file sedang ditulis
(copy bisa rusak). Pakai SQLite online backup — aman dilakukan **saat bot hidup**.

### Manual sekali jalan

```bash
sudo -u pnlbot bash -c '
  set -a; . /etc/pnl-card-bot.env; set +a
  cd /opt/pnl-card-bot
  node node_modules/tsx/dist/cli.mjs scripts/backup-db.ts
'
```

Script `scripts/backup-db.ts`:

1. membuka database read-only,
2. menyalin dengan SQLite backup API ke
   `/var/backups/pnl-card-bot/pnl-<timestamp>.sqlite`,
3. memverifikasi `PRAGMA integrity_check` dan jumlah baris kartu,
4. mengubah salinan ke journal mode `DELETE` supaya jadi satu file mandiri
   (tanpa `-wal`/`-shm`),
5. chmod `0640`,
6. menghapus backup lebih tua dari `BACKUP_KEEP_DAYS` (default 14 hari).

Contoh output:

```
Backup OK: /var/backups/pnl-card-bot/pnl-2026-10-25T03-30-12.sqlite (128 kartu)
Ukuran: 4096.0 KB
```

Alternatif dengan CLI sqlite3 (kalau lebih suka):

```bash
sqlite3 /var/lib/pnl-card-bot/pnl.sqlite ".backup '/var/backups/pnl-card-bot/pnl-$(date +%F).sqlite'"
```

### Backup otomatis harian (systemd timer)

```bash
sudo cp /opt/pnl-card-bot/deploy/pnl-card-bot-backup.service \
        /opt/pnl-card-bot/deploy/pnl-card-bot-backup.timer \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pnl-card-bot-backup.timer

# jalankan sekali untuk memastikan tidak ada error
sudo systemctl start pnl-card-bot-backup.service
sudo journalctl -u pnl-card-bot-backup -n 30 --no-pager
systemctl list-timers pnl-card-bot-backup.timer
```

Jadwal default `03:30` waktu server (`timedatectl` untuk cek zona waktu).
`Persistent=true` berarti job yang terlewat (VPS mati) dijalankan saat boot.

### Simpan juga di luar VPS

Backup di disk yang sama tidak menolong kalau VPS/disk hilang. Contoh:

```bash
# ke server lain
rsync -avz /var/backups/pnl-card-bot/ user@host-lain:/backups/pnl-card-bot/

# atau ke object storage
rclone copy /var/backups/pnl-card-bot/ remote:pnl-card-bot-backup/
```

Jalankan lewat cron/timer terpisah, misalnya sekali sehari setelah backup lokal.

## 10. Restore

```bash
# 1. hentikan bot supaya tidak ada penulisan
sudo systemctl stop pnl-card-bot

# 2. pilih backup
ls -lh /var/backups/pnl-card-bot/

# 3. pasang sebagai database aktif
sudo install -o pnlbot -g pnlbot -m 640 \
  /var/backups/pnl-card-bot/pnl-2026-10-25T03-30-12.sqlite \
  /var/lib/pnl-card-bot/pnl.sqlite

# 4. buang sidecar lama (WAJIB, kalau tidak SQLite bisa membaca state lama)
sudo rm -f /var/lib/pnl-card-bot/pnl.sqlite-wal /var/lib/pnl-card-bot/pnl.sqlite-shm

# 5. nyalakan lagi
sudo systemctl start pnl-card-bot
sudo journalctl -u pnl-card-bot -n 30 --no-pager
```

Cek di Telegram: `/history` harus menampilkan kartu dari snapshot yang direstore
dan mengirim ulang PNG yang byte-nya sama persis.

Restore ke titik waktu lama berarti kartu yang dibuat **setelah** timestamp backup
hilang. Kalau butuh keduanya, restore ke DB sementara lalu salin barisnya:

```bash
sqlite3 /var/lib/pnl-card-bot/pnl.sqlite \
  "ATTACH '/var/backups/pnl-card-bot/pnl-2026-10-25T03-30-12.sqlite' AS b;
   INSERT OR IGNORE INTO positions SELECT * FROM b.positions;"
```

---

## 11. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `TELEGRAM_BOT_TOKEN masih kosong` di journal | Env file tidak terbaca: cek `EnvironmentFile=` di unit, lalu `systemctl restart`. |
| `401 Unauthorized` | Token salah, ada spasi/quote, atau sudah di-revoke. Buat token baru di @BotFather. |
| `Missing font .../JetBrainsMono-Bold.ttf` | `assets/fonts` tidak ter-upload. Jalankan `npm run fonts`. |
| `SqliteError: unable to open database file` | `DB_PATH` di luar `StateDirectory`, atau owner bukan `pnlbot`. Cek `ls -l /var/lib/pnl-card-bot`. |
| `Could not locate the bindings file` | better-sqlite3 belum terbuild untuk Node ini: `npm rebuild better-sqlite3`. |
| Kartu menampilkan `N/A` di angka Rp | Kurs gagal diambil saat kartu dibuat (outbound HTTPS diblokir/API down). Sesuai desain, tidak pernah diestimasi. |
| Tanggal close salah beberapa jam | Set `BOT_TIMEZONE=Asia/Jakarta` lalu restart. |
| Service restart terus-menerus | Lihat `journalctl -u pnl-card-bot -n 50`; biasanya token atau permission. |
| RAM naik | Normal ~150–250 MB (resvg + font). VPS 1 GB cukup untuk satu instance. |

---

## 12. Checklist

- [ ] `node -v` >= 20 (disarankan 22)
- [ ] `sudo -u pnlbot` bisa menulis ke `/var/lib/pnl-card-bot`
- [ ] `/etc/pnl-card-bot.env` berisi token valid, mode 0640
- [ ] `systemctl status pnl-card-bot` active (running)
- [ ] `/newpnl` menghasilkan kartu di Telegram
- [ ] `/history` mengirim ulang kartu yang sama
- [ ] `systemctl list-timers` menampilkan `pnl-card-bot-backup.timer`
- [ ] Satu file backup sudah tersalin ke luar VPS
- [ ] Restore dari backup pernah dicoba minimal sekali
